type StagedPatchWrites = Vec<(String, Option<Vec<u8>>)>;
use crate::commands::search::{ZeroRegex, replace_regex_count_in_text, replace_regex_in_text};
use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::{SafeBashFs, resolve_posix_path};
use std::collections::BTreeMap;

pub fn try_run_text_command(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> Option<BuiltinOutcome> {
    match cmd {
        "sed" => Some(cmd_sed(args, stdin, cwd, fs)),
        "awk" | "gawk" | "mawk" => Some(cmd_awk(args, stdin, cwd, env, fs)),
        "diff" => Some(cmd_diff(args, stdin, cwd, fs)),
        "diff3" => Some(cmd_diff3(args, cwd, fs)),
        "patch" => Some(cmd_patch(args, stdin, cwd, fs)),
        "apply_patch" | "apply-patch" => Some(cmd_apply_patch(args, stdin, cwd, fs)),
        "cmp" => Some(cmd_cmp(args, stdin, cwd, fs)),
        "wdiff" => Some(cmd_wdiff(args, stdin, cwd, fs)),
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
    Step(usize, usize),
    RelPlus(usize),
    RelStep(usize),
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
        write_file: Option<String>,
    },
    Delete,
    DeleteFirstLine,
    Print,
    PrintFirstLine,
    Quit(Option<i32>),
    QuitSilent(Option<i32>),
    Zap,
    Filename,
    List,
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
    Next,
    NextAppend,
    Label(String),
    Branch(Option<String>),
    BranchIfSubst(Option<String>),
    BranchIfNotSubst(Option<String>),
    WriteFile(String),
    Group(Vec<SedCmd>),
}

#[derive(Clone, Debug)]
struct SedCmd {
    addr1: Option<SedAddr>,
    addr2: Option<SedAddr>,
    negated: bool,
    op: SedOp,
    in_range: bool,
    range_start_line: usize,
}

fn cmd_sed(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut quiet = false;
    let mut extended = false;
    let mut separate = false;
    let mut null_data = false;
    let mut in_place = false;
    let mut in_place_suffix = String::new();
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
                extended = true;
            } else if a == "-s" || a == "--separate" {
                separate = true;
            } else if a == "-z" || a == "--null-data" {
                null_data = true;
            } else if let Some(suf) = a.strip_prefix("-i") {
                in_place = true;
                in_place_suffix = suf.to_string();
            } else if let Some(suf) = a.strip_prefix("--in-place=") {
                in_place = true;
                in_place_suffix = suf.to_string();
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
                        'E' | 'r' => extended = true,
                        's' => separate = true,
                        'z' => null_data = true,
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
            if let Some(c) = parse_sed_cmd(&part, extended, cwd, fs) {
                parsed_cmds.push(c);
            }
        }
    }

    let mut write_files: BTreeMap<String, String> = BTreeMap::new();

    if in_place && !files.is_empty() {
        for f in &files {
            let full = resolve_posix_path(cwd, f);
            if let Ok(bytes) = fs.read_file(&full) {
                if !in_place_suffix.is_empty() {
                    let _ = fs.write_file(&format!("{full}{in_place_suffix}"), &bytes);
                }
                let content = String::from_utf8_lossy(&bytes);
                let mut cmds_copy = parsed_cmds.clone();
                let (res, _) = run_sed_on_text(&content, f, &mut cmds_copy, quiet, null_data, &mut write_files);
                let _ = fs.write_file(&full, res.as_bytes());
            } else {
                return err_out(&format!("sed: {f}: No such file or directory\n"), 1);
            }
        }
        for (wf, data) in write_files {
            let _ = fs.write_file(&resolve_posix_path(cwd, &wf), data.as_bytes());
        }
        return ok_out("");
    }

    if separate && !files.is_empty() {
        let mut total_out = String::new();
        for f in &files {
            let content = if f == "-" {
                stdin.to_string()
            } else {
                let full = resolve_posix_path(cwd, f);
                match fs.read_file(&full) {
                    Ok(b) => String::from_utf8_lossy(&b).into_owned(),
                    Err(_) => return err_out(&format!("sed: {f}: No such file or directory\n"), 1),
                }
            };
            let mut cmds_copy = parsed_cmds.clone();
            let (part_out, code) = run_sed_on_text(&content, f, &mut cmds_copy, quiet, null_data, &mut write_files);
            total_out.push_str(&part_out);
            if code != 0 {
                for (wf, data) in write_files {
                    let _ = fs.write_file(&resolve_posix_path(cwd, &wf), data.as_bytes());
                }
                return BuiltinOutcome { stdout: total_out, stderr: String::new(), exit_code: code };
            }
        }
        for (wf, data) in write_files {
            let _ = fs.write_file(&resolve_posix_path(cwd, &wf), data.as_bytes());
        }
        return ok_out(&total_out);
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

    let cur_fname = files.first().map(|s| s.as_str()).unwrap_or("-");
    let (out, exit_code) = run_sed_on_text(&combined_in, cur_fname, &mut parsed_cmds, quiet, null_data, &mut write_files);
    for (wf, data) in write_files {
        let _ = fs.write_file(&resolve_posix_path(cwd, &wf), data.as_bytes());
    }
    BuiltinOutcome {
        stdout: out,
        stderr: String::new(),
        exit_code,
    }
}

fn split_sed_statements(script: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = script.chars().collect();
    let mut idx = 0usize;
    let mut in_slash: Option<char> = None;
    let mut slash_count = 0usize;
    let mut in_addr_regex = false;
    let mut brace_depth = 0i32;

    while idx < chars.len() {
        let c = chars[idx];
        if c == '\\' && idx + 1 < chars.len() {
            cur.push(c);
            cur.push(chars[idx + 1]);
            idx += 2;
            continue;
        }
        if c == '\n' {
            in_slash = None;
            in_addr_regex = false;
            if brace_depth == 0 {
                let t = cur.trim().to_string();
                if !t.is_empty() {
                    out.push(t);
                }
                cur.clear();
            } else {
                cur.push('\n');
            }
            idx += 1;
            continue;
        }
        if in_addr_regex {
            cur.push(c);
            if c == '/' {
                in_addr_regex = false;
            }
            idx += 1;
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
        if c == '/' && {
            let ct = cur.trim();
            ct.is_empty() || ct.ends_with(',') || ct.ends_with('{')
        } {
            in_addr_regex = true;
            cur.push(c);
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
    out
}

fn convert_bre_parens(pat: &str) -> String {
    let mut out = String::with_capacity(pat.len() + 4);
    let chs: Vec<char> = pat.chars().collect();
    let mut k = 0usize;
    let mut in_bracket = false;
    while k < chs.len() {
        if chs[k] == '\\' && k + 1 < chs.len() {
            let nc = chs[k + 1];
            if !in_bracket && (nc == '(' || nc == ')' || nc == '|') {
                out.push(nc);
            } else {
                out.push('\\');
                out.push(nc);
            }
            k += 2;
        } else if chs[k] == '[' && !in_bracket {
            in_bracket = true;
            out.push('[');
            k += 1;
            if k < chs.len() && (chs[k] == '^' || chs[k] == '!') {
                out.push(chs[k]);
                k += 1;
            }
            if k < chs.len() && chs[k] == ']' {
                out.push(']');
                k += 1;
            }
        } else if in_bracket && chs[k] == '[' && k + 1 < chs.len() && matches!(chs[k + 1], ':' | '.' | '=') {
            let kind = chs[k + 1];
            out.push('[');
            out.push(kind);
            k += 2;
            while k < chs.len() {
                out.push(chs[k]);
                if chs[k] == kind && k + 1 < chs.len() && chs[k + 1] == ']' {
                    out.push(']');
                    k += 2;
                    break;
                }
                k += 1;
            }
        } else if chs[k] == ']' && in_bracket {
            in_bracket = false;
            out.push(']');
            k += 1;
        } else if !in_bracket && (chs[k] == '(' || chs[k] == ')' || chs[k] == '|') {
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
}

fn convert_ere_escaped_parens(pat: &str) -> String {
    let mut out = String::with_capacity(pat.len() + 4);
    let chs: Vec<char> = pat.chars().collect();
    let mut k = 0usize;
    let mut in_bracket = false;
    while k < chs.len() {
        if chs[k] == '\\' && k + 1 < chs.len() {
            let nc = chs[k + 1];
            if !in_bracket && (nc == '(' || nc == ')') {
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
        } else {
            out.push(chs[k]);
            k += 1;
        }
    }
    out
}

fn parse_sed_cmd(stmt: &str, extended: bool, cwd: &str, fs: &dyn SafeBashFs) -> Option<SedCmd> {
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
            range_start_line: 0,
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
        'D' => SedOp::DeleteFirstLine,
        'p' => SedOp::Print,
        'P' => SedOp::PrintFirstLine,
        'q' => SedOp::Quit(rest[1..].trim().parse::<i32>().ok()),
        'Q' => SedOp::QuitSilent(rest[1..].trim().parse::<i32>().ok()),
        'z' => SedOp::Zap,
        'F' => SedOp::Filename,
        'l' => SedOp::List,
        '=' => SedOp::LineNumber,
        'h' => SedOp::HoldCopy,
        'H' => SedOp::HoldAppend,
        'g' => SedOp::GetCopy,
        'G' => SedOp::GetAppend,
        'x' => SedOp::Exchange,
        'n' => SedOp::Next,
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
        't' => {
            let target = rest[1..].trim();
            SedOp::BranchIfSubst(if target.is_empty() {
                None
            } else {
                Some(target.to_string())
            })
        }
        'T' => {
            let target = rest[1..].trim();
            SedOp::BranchIfNotSubst(if target.is_empty() {
                None
            } else {
                Some(target.to_string())
            })
        }
        'w' => {
            let wf = rest[1..].trim().to_string();
            SedOp::WriteFile(wf)
        }
        'r' => {
            let rf = rest[1..].trim();
            let full = resolve_posix_path(cwd, rf);
            if let Ok(bytes) = fs.read_file(&full) {
                let content = String::from_utf8_lossy(&bytes);
                let trimmed = content.strip_suffix('\n').unwrap_or(&content).to_string();
                SedOp::Append(trimmed)
            } else {
                SedOp::Group(Vec::new())
            }
        }
        '{' => {
            let inner = rest
                .strip_prefix('{')
                .and_then(|r| r.strip_suffix('}'))
                .unwrap_or(&rest[1..]);
            let mut sub_cmds = Vec::new();
            for part in split_sed_statements(inner) {
                if let Some(c) = parse_sed_cmd(&part, extended, cwd, fs) {
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
            SedOp::Transliterate(
                unescape_sed_text(&parts[0]).chars().collect(),
                unescape_sed_text(&parts[1]).chars().collect(),
            )
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
            let pat = if extended {
                convert_ere_escaped_parens(&parts[0])
            } else {
                convert_bre_parens(&parts[0])
            };
            let repl = unescape_sed_repl(&parts[1]);
            let flags = parts.get(2).cloned().unwrap_or_default();
            let mut global = false;
            let mut ignore_case = false;
            let mut print_flag = false;
            let mut nth = None;
            let mut write_file = None;
            for (f_idx, ch) in flags.char_indices() {
                match ch {
                    'g' => global = true,
                    'i' | 'I' => ignore_case = true,
                    'p' => print_flag = true,
                    '1'..='9' => nth = Some((ch as u8 - b'0') as usize),
                    'w' => {
                        let wf = flags[f_idx + 1..].trim();
                        if !wf.is_empty() {
                            write_file = Some(wf.to_string());
                        }
                        break;
                    }
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
                write_file,
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
        range_start_line: 0,
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
                Some('a') => out.push('\x07'),
                Some('b') => out.push('\x08'),
                Some('f') => out.push('\x0c'),
                Some('v') => out.push('\x0b'),
                Some('x') => {
                    let mut hex = String::new();
                    for _ in 0..2 {
                        if let Some(&hc) = chars.peek()
                            && hc.is_ascii_hexdigit()
                        {
                            hex.push(chars.next().unwrap());
                        } else {
                            break;
                        }
                    }
                    if let Ok(code) = u8::from_str_radix(&hex, 16) {
                        out.push(code as char);
                    } else {
                        out.push('x');
                        out.push_str(&hex);
                    }
                }
                Some(d @ '0'..='7') => {
                    let mut oct = String::from(d);
                    for _ in 0..2 {
                        if let Some(&oc) = chars.peek()
                            && ('0'..='7').contains(&oc)
                        {
                            oct.push(chars.next().unwrap());
                        } else {
                            break;
                        }
                    }
                    if let Ok(code) = u8::from_str_radix(&oct, 8) {
                        out.push(code as char);
                    } else {
                        out.push_str(&oct);
                    }
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

fn unescape_sed_repl(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some(d @ ('0'..='9' | 'U' | 'L' | 'E' | 'u' | 'l' | '&' | '\\')) => {
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
    if let Some(rest) = s.strip_prefix('+') {
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<usize>() {
            return (Some(SedAddr::RelPlus(n)), &rest[digits.len()..]);
        }
    }
    if let Some(rest) = s.strip_prefix('~') {
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<usize>() {
            return (Some(SedAddr::RelStep(n.max(1))), &rest[digits.len()..]);
        }
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
    if !digits.is_empty()
        && let Ok(n) = digits.parse::<usize>()
    {
        let after_n = &s[digits.len()..];
        if let Some(after_tilde) = after_n.strip_prefix('~') {
            let step_digits: String = after_tilde.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(step) = step_digits.parse::<usize>() {
                return (Some(SedAddr::Step(n, step.max(1))), &after_tilde[step_digits.len()..]);
            }
        }
        return (Some(SedAddr::Line(n)), after_n);
    }
    (None, s)
}

fn addr_matches(addr: &SedAddr, line_num: usize, is_last: bool, line: &str) -> bool {
    match addr {
        SedAddr::Line(n) => line_num == *n,
        SedAddr::Step(first, step) => {
            if *first == 0 {
                line_num.is_multiple_of(*step)
            } else {
                line_num >= *first && (line_num - *first).is_multiple_of(*step)
            }
        }
        SedAddr::RelPlus(_) | SedAddr::RelStep(_) => false,
        SedAddr::Last => is_last,
        SedAddr::Regex(pat) => {
            if (pat == "^\\(.*\\)\\n\\1$" || pat == "^(.*)\\n\\1$")
                && let Some((a, b)) = line.split_once('\n')
            {
                return a == b;
            }
            let unescaped = pat.replace("\\n", "\n");
            ZeroRegex::new(vec![unescaped], false, false, false, false).is_match(line)
        }
    }
}

enum SedFlow {
    Continue,
    Delete,
    RestartCycle,
    Quit(Option<i32>, bool),
    Branch(Option<String>),
}

#[allow(clippy::too_many_arguments)]
fn exec_sed_cmds(
    cmds: &mut [SedCmd],
    raw_lines: &[&str],
    filename: &str,
    line_idx: &mut usize,
    pattern_space: &mut String,
    hold_space: &mut String,
    subst_made: &mut bool,
    out: &mut String,
    appends: &mut Vec<String>,
    write_files: &mut BTreeMap<String, String>,
    _quiet: bool,
    rec_term: char,
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
                    let start_matched = match a1 {
                        SedAddr::Line(0) => line_num == 1 && cmd.range_start_line == 0,
                        other => addr_matches(other, line_num, is_last, pattern_space),
                    };
                    if start_matched {
                        let end_same = match a2 {
                            SedAddr::Line(n) => *n <= line_num,
                            SedAddr::RelPlus(0) => true,
                            other => matches!(a1, SedAddr::Line(0)) && addr_matches(other, line_num, is_last, pattern_space),
                        };
                        if !end_same {
                            cmd.in_range = true;
                        }
                        cmd.range_start_line = line_num;
                        true
                    } else {
                        false
                    }
                } else {
                    let end_hit = match a2 {
                        SedAddr::RelPlus(n) => line_num >= cmd.range_start_line + *n,
                        SedAddr::RelStep(step) => line_num > cmd.range_start_line && line_num.is_multiple_of(*step),
                        other => addr_matches(other, line_num, is_last, pattern_space),
                    };
                    if end_hit {
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

        let still_in_range = cmd.in_range;
        let mut branch_target: Option<Option<String>> = None;
        match &mut cmd.op {
            SedOp::Label(_) => {}
            SedOp::Delete => return SedFlow::Delete,
            SedOp::DeleteFirstLine => {
                if let Some(nl_pos) = pattern_space.find('\n') {
                    *pattern_space = pattern_space[nl_pos + 1..].to_string();
                    return SedFlow::RestartCycle;
                }
                return SedFlow::Delete;
            }
            SedOp::Print => {
                out.push_str(pattern_space);
                out.push(rec_term);
            }
            SedOp::PrintFirstLine => {
                let first_line = pattern_space.split('\n').next().unwrap_or(pattern_space);
                out.push_str(first_line);
                out.push(rec_term);
            }
            SedOp::Quit(code) => return SedFlow::Quit(*code, false),
            SedOp::QuitSilent(code) => return SedFlow::Quit(*code, true),
            SedOp::Zap => {
                pattern_space.clear();
            }
            SedOp::Filename => {
                out.push_str(filename);
                out.push('\n');
            }
            SedOp::List => {
                for ch in pattern_space.chars() {
                    match ch {
                        '\\' => out.push_str("\\\\"),
                        '\t' => out.push_str("\\t"),
                        '\r' => out.push_str("\\r"),
                        '\x07' => out.push_str("\\a"),
                        '\x08' => out.push_str("\\b"),
                        c => out.push(c),
                    }
                }
                out.push_str("$\n");
            }
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
            SedOp::Next => {
                if !_quiet {
                    out.push_str(pattern_space);
                    out.push(rec_term);
                }
                for ap in appends.drain(..) {
                    out.push_str(&ap);
                    out.push(rec_term);
                }
                if *line_idx + 1 < total {
                    *line_idx += 1;
                    *pattern_space = raw_lines[*line_idx].to_string();
                    *subst_made = false;
                } else {
                    return SedFlow::Delete;
                }
            }
            SedOp::NextAppend => {
                if *line_idx + 1 < total {
                    *line_idx += 1;
                    pattern_space.push('\n');
                    pattern_space.push_str(raw_lines[*line_idx]);
                    *subst_made = false;
                } else {
                    return SedFlow::Quit(None, false);
                }
            }
            SedOp::Branch(lbl) => {
                branch_target = Some(lbl.clone());
            }
            SedOp::BranchIfSubst(lbl) => {
                if *subst_made {
                    *subst_made = false;
                    branch_target = Some(lbl.clone());
                }
            }
            SedOp::BranchIfNotSubst(lbl) => {
                if !*subst_made {
                    branch_target = Some(lbl.clone());
                }
            }
            SedOp::WriteFile(wf) => {
                let buf = write_files.entry(wf.clone()).or_default();
                buf.push_str(pattern_space);
                buf.push(rec_term);
            }
            SedOp::Group(inner) => {
                match exec_sed_cmds(
                    inner,
                    raw_lines,
                    filename,
                    line_idx,
                    pattern_space,
                    hold_space,
                    subst_made,
                    out,
                    appends,
                    write_files,
                    _quiet,
                    rec_term,
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
                out.push(rec_term);
            }
            SedOp::Append(text) => {
                appends.push(text.clone());
            }
            SedOp::Change(text) => {
                if !still_in_range || is_last {
                    out.push_str(text);
                    out.push(rec_term);
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
                write_file,
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
                if did_replace {
                    *subst_made = true;
                    if *print_flag {
                        out.push_str(pattern_space);
                        out.push(rec_term);
                    }
                    if let Some(wf) = write_file {
                        let buf = write_files.entry(wf.clone()).or_default();
                        buf.push_str(pattern_space);
                        buf.push(rec_term);
                    }
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

fn run_sed_on_text(
    input: &str,
    filename: &str,
    cmds: &mut [SedCmd],
    quiet: bool,
    null_data: bool,
    write_files: &mut BTreeMap<String, String>,
) -> (String, i32) {
    if input.is_empty() {
        return (String::new(), 0);
    }
    let rec_term = if null_data { '\0' } else { '\n' };
    let had_trailing_delim = input.ends_with(rec_term);
    let raw_lines: Vec<&str> = if null_data {
        let mut v: Vec<&str> = input.split('\0').collect();
        if v.last() == Some(&"") {
            v.pop();
        }
        v
    } else {
        input.lines().collect()
    };
    let total = raw_lines.len();
    let mut out = String::new();
    let mut hold_space = String::new();
    let mut line_idx = 0usize;
    let mut exit_code = 0i32;

    while line_idx < total {
        let mut pattern_space = raw_lines[line_idx].to_string();
        let mut deleted = false;
        let mut quit_now = false;
        let mut appends: Vec<String> = Vec::new();
        let mut subst_made = false;
        let mut restart_guard = 0usize;

        loop {
            match exec_sed_cmds(
                cmds,
                &raw_lines,
                filename,
                &mut line_idx,
                &mut pattern_space,
                &mut hold_space,
                &mut subst_made,
                &mut out,
                &mut appends,
                write_files,
                quiet,
                rec_term,
            ) {
                SedFlow::Delete => {
                    deleted = true;
                    break;
                }
                SedFlow::RestartCycle => {
                    restart_guard += 1;
                    if restart_guard > 1000 {
                        break;
                    }
                    subst_made = false;
                    continue;
                }
                SedFlow::Quit(code, silent) => {
                    quit_now = true;
                    exit_code = code.unwrap_or(0);
                    if silent {
                        deleted = true;
                    }
                    break;
                }
                SedFlow::Continue | SedFlow::Branch(_) => break,
            }
        }

        let is_last = line_idx + 1 == total;
        if !deleted && !quiet {
            out.push_str(&pattern_space);
            if !is_last || had_trailing_delim {
                out.push(rec_term);
            }
        }
        for ap in appends {
            out.push_str(&ap);
            out.push(rec_term);
        }
        if quit_now {
            break;
        }
        line_idx += 1;
    }

    (out, exit_code)
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

struct AwkState<'a> {
    vars: BTreeMap<String, String>,
    arrays: BTreeMap<String, BTreeMap<String, String>>,
    funcs: AwkFuncMap,
    fields: Vec<String>,
    line: String,
    nr: usize,
    fnr: usize,
    fs: String,
    rs: String,
    ofs: String,
    ors: String,
    output: String,
    next_requested: bool,
    nextfile_requested: bool,
    return_val: Option<String>,
    exit_code: Option<i32>,
    cwd: String,
    vfs: &'a dyn SafeBashFs,
    getline_files: BTreeMap<String, (Vec<String>, usize)>,
    stream_lines: Vec<String>,
    stream_idx: usize,
    redirect_written: BTreeMap<String, bool>,
}

impl<'a> AwkState<'a> {
    fn new(
        fs: String,
        mut vars: BTreeMap<String, String>,
        funcs: AwkFuncMap,
        cwd: &str,
        vfs: &'a dyn SafeBashFs,
    ) -> Self {
        let ofs = vars.get("OFS").cloned().unwrap_or_else(|| " ".to_string());
        let ors = vars.get("ORS").cloned().unwrap_or_else(|| "\n".to_string());
        let rs = vars.get("RS").cloned().unwrap_or_else(|| "\n".to_string());
        vars.entry("SUBSEP".to_string()).or_insert_with(|| "\x1c".to_string());
        Self {
            vars,
            arrays: BTreeMap::new(),
            funcs,
            fields: Vec::new(),
            line: String::new(),
            nr: 0,
            fnr: 0,
            fs,
            rs,
            ofs,
            ors,
            output: String::new(),
            next_requested: false,
            nextfile_requested: false,
            return_val: None,
            exit_code: None,
            cwd: cwd.to_string(),
            vfs,
            getline_files: BTreeMap::new(),
            stream_lines: Vec::new(),
            stream_idx: 0,
            redirect_written: BTreeMap::new(),
        }
    }

    fn read_getline_from_stream(&mut self, into_var: Option<&str>) -> String {
        if self.stream_idx < self.stream_lines.len() {
            let l = self.stream_lines[self.stream_idx].clone();
            self.stream_idx += 1;
            self.nr += 1;
            self.fnr += 1;
            if let Some(vn) = into_var
                && !vn.is_empty()
            {
                self.set_var(vn, l);
            } else {
                self.set_line(&l);
            }
            "1".to_string()
        } else {
            "0".to_string()
        }
    }

    fn write_redirect(&mut self, raw_path: &str, append: bool, data: &str) {
        let full = resolve_posix_path(&self.cwd, raw_path);
        let should_append = append || self.redirect_written.get(&full).copied().unwrap_or(false);
        self.redirect_written.insert(full.clone(), true);
        if should_append {
            let mut cur = self.vfs.read_file(&full).unwrap_or_default();
            cur.extend_from_slice(data.as_bytes());
            let _ = self.vfs.write_file(&full, &cur);
        } else {
            let _ = self.vfs.write_file(&full, data.as_bytes());
        }
    }

    fn read_getline_from_file(&mut self, raw_path: &str, into_var: Option<&str>) -> String {
        let full = resolve_posix_path(&self.cwd, raw_path);
        if !self.getline_files.contains_key(&full) {
            match self.vfs.read_file(&full) {
                Ok(b) => {
                    let lines: Vec<String> = String::from_utf8_lossy(&b)
                        .lines()
                        .map(|s| s.to_string())
                        .collect();
                    self.getline_files.insert(full.clone(), (lines, 0));
                }
                Err(_) => return "-1".to_string(),
            }
        }
        let next_line = if let Some((lines, cur)) = self.getline_files.get_mut(&full) {
            if *cur < lines.len() {
                let l = lines[*cur].clone();
                *cur += 1;
                Some(l)
            } else {
                None
            }
        } else {
            None
        };
        if let Some(l) = next_line {
            if let Some(vn) = into_var
                && !vn.is_empty()
            {
                self.set_var(vn, l);
            } else {
                self.set_line(&l);
            }
            "1".to_string()
        } else {
            "0".to_string()
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
            "RS" => self.rs.clone(),
            "OFS" => self.ofs.clone(),
            "ORS" => self.ors.clone(),
            _ => self.vars.get(name).cloned().unwrap_or_default(),
        }
    }

    fn set_var(&mut self, name: &str, val: String) {
        match name {
            "FS" => self.fs = val,
            "RS" => self.rs = val,
            "OFS" => self.ofs = val,
            "ORS" => self.ors = val,
            "NF" => {
                let new_nf = val.trim().parse::<usize>().unwrap_or(0);
                self.fields.resize(new_nf, String::new());
                self.rebuild_line_from_fields();
            }
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

fn cmd_awk(args: &[String], stdin: &str, cwd: &str, env: &BTreeMap<String, String>, fs: &dyn SafeBashFs) -> BuiltinOutcome {
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
        } else if a == "-l" || a == "--load" {
            if i + 1 < args.len() {
                i += 1;
            }
        } else if a.starts_with("-l") || a.starts_with("--load=") {
            // loaded extension
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
    let mut state = AwkState::new(field_sep, vars, funcs, cwd, fs);
    state.arrays.insert("ENVIRON".to_string(), env.clone());

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
        enum AwkInputItem {
            VarAssign(String, String),
            File(String, String),
        }
        let mut inputs = Vec::new();
        if files.is_empty() {
            inputs.push(AwkInputItem::File("".to_string(), stdin.to_string()));
        } else {
            for f in &files {
                if f == "-" {
                    inputs.push(AwkInputItem::File("-".to_string(), stdin.to_string()));
                    continue;
                }
                if let Some((k, v)) = f.split_once('=') {
                    if !f.contains('/') && !fs.exists(&resolve_posix_path(cwd, f)) {
                        inputs.push(AwkInputItem::VarAssign(k.to_string(), unescape_sed_text(v)));
                        continue;
                    }
                }
                let full = resolve_posix_path(cwd, f);
                match fs.read_file(&full) {
                    Ok(b) => inputs.push(AwkInputItem::File(f.clone(), String::from_utf8_lossy(&b).into_owned())),
                    Err(_) => {
                        return err_out(&format!("awk: can't open file {f}\n"), 2);
                    }
                }
            }
        }

        'input_loop: for item in inputs {
            let (fname, content) = match item {
                AwkInputItem::VarAssign(k, v) => {
                    state.set_var(&k, v);
                    continue 'input_loop;
                }
                AwkInputItem::File(fname, content) => (fname, content),
            };
            state.set_var("FILENAME", fname);
            state.fnr = 0;
            state.nextfile_requested = false;
            state.stream_lines = if state.rs.is_empty() {
                let mut recs = Vec::new();
                let mut cur_par = Vec::new();
                for l in content.lines() {
                    if l.is_empty() {
                        if !cur_par.is_empty() {
                            recs.push(cur_par.join("\n"));
                            cur_par.clear();
                        }
                    } else {
                        cur_par.push(l.to_string());
                    }
                }
                if !cur_par.is_empty() {
                    recs.push(cur_par.join("\n"));
                }
                recs
            } else if state.rs != "\n" {
                let mut recs: Vec<String> = content.split(&state.rs).map(|s| s.to_string()).collect();
                if recs.last().is_some_and(|s| s.is_empty()) {
                    recs.pop();
                }
                recs
            } else {
                content.lines().map(|l| l.to_string()).collect()
            };
            state.stream_idx = 0;
            while state.stream_idx < state.stream_lines.len() {
                let line = state.stream_lines[state.stream_idx].clone();
                state.stream_idx += 1;
                state.nr += 1;
                state.fnr += 1;
                state.set_line(&line);
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
                    if state.nextfile_requested || state.next_requested {
                        break;
                    }
                }
                if state.nextfile_requested {
                    state.nextfile_requested = false;
                    break;
                }
            }
        }
    }

    state.next_requested = false;
    state.nextfile_requested = false;
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
        while idx < chars.len()
            && ((in_quote || in_regex)
                || (chars[idx] != '{' && chars[idx] != '\n' && chars[idx] != ';'))
        {
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
            let mut in_rx = false;
            while idx < chars.len() && depth > 0 {
                let c = chars[idx];
                if c == '\\' && idx + 1 < chars.len() {
                    b.push(c);
                    b.push(chars[idx + 1]);
                    idx += 2;
                    continue;
                }
                if c == '\n' {
                    in_rx = false;
                }
                if c == '"' && !in_rx {
                    q = !q;
                } else if !q {
                    if c == '/' {
                        if in_rx {
                            in_rx = false;
                        } else if awk_prev_allows_regex(&b) {
                            in_rx = true;
                        }
                    } else if !in_rx {
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

fn awk_prev_allows_regex(prefix: &str) -> bool {
    matches!(
        prefix.trim_end().chars().last(),
        None | Some('(' | ',' | '~' | '!' | '=' | ';' | '{' | '|' | '&' | '?' | ':')
    )
}

fn awk_chars_allow_regex(chars: &[char], idx: usize) -> bool {
    let prev = chars[..idx].iter().rev().find(|c| !c.is_whitespace()).copied();
    matches!(
        prev,
        None | Some('(' | ',' | '~' | '!' | '=' | ';' | '{' | '|' | '&' | '?' | ':')
    )
}

fn split_awk_statements(block: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = block.chars().collect();
    let mut idx = 0usize;
    let mut quote = false;
    let mut in_rx = false;
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
        if c == '"' && !in_rx {
            quote = !quote;
            cur.push(c);
            idx += 1;
            continue;
        }
        if !quote && c == '/' {
            if in_rx {
                in_rx = false;
                cur.push(c);
                idx += 1;
                continue;
            } else if awk_prev_allows_regex(&cur) {
                in_rx = true;
                cur.push(c);
                idx += 1;
                continue;
            }
        }
        if c == '\n' {
            in_rx = false;
        }
        if !quote && !in_rx {
            match c {
                '(' => paren += 1,
                ')' => paren -= 1,
                '{' => brace += 1,
                '}' => {
                    brace -= 1;
                    cur.push(c);
                    if brace == 0 && paren == 0 {
                        let rest: String = chars[idx + 1..].iter().collect();
                        if rest.trim_start().starts_with("else") && cur.trim_start().starts_with("if") {
                            idx += 1;
                            continue;
                        }
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
                    if c == '\n' && cur.trim_end().ends_with([',', '|', '&', '?', ':']) {
                        cur.push(' ');
                        idx += 1;
                        continue;
                    }
                    let rest: String = chars[idx + 1..].iter().collect();
                    let rest_after_sep = rest.trim_start_matches([' ', '\t', '\n', '\r', ';']);
                    if (rest_after_sep == "else"
                        || rest_after_sep.starts_with("else ")
                        || rest_after_sep.starts_with("else\t")
                        || rest_after_sep.starts_with("else\n")
                        || rest_after_sep.starts_with("else{"))
                        && cur.trim_start().starts_with("if")
                    {
                        let cur_trimmed = cur.trim_end();
                        if !cur_trimmed.ends_with(';') && !cur_trimmed.ends_with('}') {
                            cur.push(';');
                        } else {
                            cur.push(' ');
                        }
                        idx += 1;
                        continue;
                    }
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

fn eval_awk_array_key(key_expr: &str, state: &mut AwkState) -> String {
    let trimmed = key_expr.trim();
    let inner = if trimmed.starts_with('(') && trimmed.ends_with(')') && is_awk_outer_parens(trimmed) {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    };
    let parts = split_awk_top_args(inner);
    if parts.len() <= 1 {
        eval_awk_expr(inner, state)
    } else {
        let subsep = {
            let s = state.get_var("SUBSEP");
            if s.is_empty() { "\x1c".to_string() } else { s }
        };
        let vals: Vec<String> = parts.iter().map(|p| eval_awk_expr(p, state)).collect();
        vals.join(&subsep)
    }
}

fn is_awk_outer_braces(s: &str) -> bool {
    if !s.starts_with('{') || !s.ends_with('}') {
        return false;
    }
    let chars: Vec<char> = s.chars().collect();
    let mut depth = 0i32;
    let mut quote = false;
    for (idx, &c) in chars.iter().enumerate() {
        if c == '\\' {
            continue;
        }
        if c == '"' {
            quote = !quote;
        } else if !quote {
            if c == '{' {
                depth += 1;
            } else if c == '}' {
                depth -= 1;
                if depth == 0 && idx + 1 < chars.len() {
                    return false;
                }
            }
        }
    }
    depth == 0
}

fn split_awk_top_else(s: &str) -> Option<(&str, &str)> {
    let bytes = s.as_bytes();
    let mut paren = 0i32;
    let mut brace = 0i32;
    let mut quote = false;
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'\\' && i + 1 < bytes.len() {
            i += 2;
            continue;
        }
        if b == b'"' {
            quote = !quote;
            i += 1;
            continue;
        }
        if !quote {
            match b {
                b'(' => paren += 1,
                b')' => paren -= 1,
                b'{' => brace += 1,
                b'}' => brace -= 1,
                b'e' if paren == 0 && brace == 0 && i + 4 <= bytes.len() && &bytes[i..i + 4] == b"else" => {
                    let prev_ok = i == 0 || matches!(bytes[i - 1], b' ' | b'\t' | b'\n' | b'\r' | b';' | b'}');
                    let next_ok = i + 4 == bytes.len() || matches!(bytes[i + 4], b' ' | b'\t' | b'\n' | b'\r' | b'{');
                    if prev_ok && next_ok {
                        return Some((&s[..i], &s[i + 4..]));
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }
    None
}

fn is_awk_outer_parens(s: &str) -> bool {
    if !s.starts_with('(') || !s.ends_with(')') {
        return false;
    }
    let chars: Vec<char> = s.chars().collect();
    let mut depth = 0i32;
    let mut quote = false;
    for (idx, &c) in chars.iter().enumerate() {
        if c == '"' {
            quote = !quote;
        } else if !quote {
            if c == '(' {
                depth += 1;
            } else if c == ')' {
                depth -= 1;
                if depth == 0 && idx + 1 < chars.len() {
                    return false;
                }
            }
        }
    }
    depth == 0
}

fn exec_awk_block(block: &str, state: &mut AwkState) {
    let stmts = split_awk_statements(block);
    let mut idx = 0usize;
    while idx < stmts.len() {
        if state.next_requested || state.nextfile_requested || state.return_val.is_some() || state.exit_code.is_some() {
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
        if stmt == "nextfile" {
            state.nextfile_requested = true;
            state.next_requested = true;
            return;
        }
        if let Some(del_rest) = stmt.strip_prefix("delete ") {
            let target = del_rest.trim();
            if let Some(open) = target.find('[')
                && target.ends_with(']')
            {
                let arr_name = target[..open].trim();
                let key = eval_awk_array_key(&target[open + 1..target.len() - 1], state);
                if let Some(map) = state.arrays.get_mut(arr_name) {
                    map.remove(&key);
                }
            } else {
                state.arrays.remove(target);
            }
            idx += 1;
            continue;
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
            let (expr_part, redir) = split_awk_redirection(rest);
            let expr_trim = expr_part.trim();
            let mut line_out = String::new();
            if expr_trim.is_empty() {
                line_out.push_str(&state.line);
                line_out.push_str(&state.ors);
            } else {
                let args = split_awk_top_args(expr_trim);
                let vals: Vec<String> = args.iter().map(|a| eval_awk_expr(a, state)).collect();
                line_out.push_str(&vals.join(&state.ofs));
                line_out.push_str(&state.ors);
            }
            if let Some((append, target_expr)) = redir {
                let target_path = eval_awk_expr(&target_expr, state);
                state.write_redirect(&target_path, append, &line_out);
            } else {
                state.output.push_str(&line_out);
            }
            idx += 1;
            continue;
        }
        if stmt.starts_with("printf ") || stmt.starts_with("printf(") {
            let rest = stmt.strip_prefix("printf").unwrap_or("").trim();
            let (expr_part, redir) = split_awk_redirection(rest);
            let expr_trim = expr_part.trim();
            let inner = if expr_trim.starts_with('(') && expr_trim.ends_with(')') && is_awk_outer_parens(expr_trim) {
                &expr_trim[1..expr_trim.len() - 1]
            } else {
                expr_trim
            };
            let args = split_awk_top_args(inner);
            if !args.is_empty() {
                let fmt_str = eval_awk_expr(&args[0], state);
                let vals: Vec<String> = args[1..].iter().map(|a| eval_awk_expr(a, state)).collect();
                let formatted = format_awk_printf(&fmt_str, &vals);
                if let Some((append, target_expr)) = redir {
                    let target_path = eval_awk_expr(&target_expr, state);
                    state.write_redirect(&target_path, append, &formatted);
                } else {
                    state.output.push_str(&formatted);
                }
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
            let rem_trim = rem.trim().trim_start_matches(';').trim();
            let else_part = if let Some(el) = rem_trim.strip_prefix("else") {
                let el_t = el.trim();
                let el_body = if is_awk_outer_braces(el_t) {
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
    if let Some((then_p, else_p)) = split_awk_top_else(after_trim) {
        let el_t = else_p.trim();
        let el_body = if is_awk_outer_braces(el_t) {
            el_t[1..el_t.len() - 1].to_string()
        } else {
            el_t.to_string()
        };
        return Some((cond, then_p.trim().trim_end_matches(';').trim().to_string(), Some(el_body)));
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
    let mut in_rx = false;
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
        if c == '"' && !in_rx {
            quote = !quote;
            cur.push(c);
            continue;
        }
        if !quote && c == '/' {
            if in_rx {
                in_rx = false;
                cur.push(c);
                continue;
            } else if awk_prev_allows_regex(&cur) {
                in_rx = true;
                cur.push(c);
                continue;
            }
        }
        if !quote && !in_rx {
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

fn is_single_awk_string_literal(s: &str) -> bool {
    if !s.starts_with('"') || !s.ends_with('"') || s.len() < 2 {
        return false;
    }
    let inner = &s[1..s.len() - 1];
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            let _ = chars.next();
        } else if c == '"' {
            return false;
        }
    }
    true
}

fn eval_awk_expr(expr: &str, state: &mut AwkState) -> String {
    let s = expr.trim();
    if s.is_empty() {
        return String::new();
    }
    if is_single_awk_string_literal(s) {
        return unescape_sed_text(&s[1..s.len() - 1]);
    }

    for op in ["+=", "-=", "*=", "/=", "^=", "="] {
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
                    "^=" => lnum.powf(rnum),
                    _ => rnum,
                };
                format_awk_num(res)
            };
            assign_awk_lvalue(&lhs, final_val.clone(), state);
            return final_val;
        }
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
    if let Some(var) = s.strip_prefix("--")
        && !var.starts_with('-')
    {
        let v = var.trim();
        let new_val = parse_awk_f64(&eval_awk_expr(v, state)) - 1.0;
        let formatted = format_awk_num(new_val);
        assign_awk_lvalue(v, formatted.clone(), state);
        return formatted;
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

    if let Some(gl_rest) = s.strip_prefix("getline")
        && (gl_rest.is_empty() || gl_rest.starts_with(' ') || gl_rest.starts_with('<'))
    {
        if let Some((var_part, file_expr)) = gl_rest.split_once('<') {
            let path = eval_awk_expr(file_expr.trim(), state);
            let var_name = var_part.trim();
            return state.read_getline_from_file(
                &path,
                if var_name.is_empty() { None } else { Some(var_name) },
            );
        }
        let var_name = gl_rest.trim();
        return state.read_getline_from_stream(if var_name.is_empty() {
            None
        } else {
            Some(var_name)
        });
    }

    for cmp_op in ["==", "!=", "<=", ">=", "!~", "~", "<", ">"] {
        if let Some((lhs, rhs)) = split_awk_binary_once(s, cmp_op) {
            let lv = eval_awk_expr(&lhs, state);
            if cmp_op == "~" || cmp_op == "!~" {
                let raw_pat = rhs.trim();
                let pat_owned = if raw_pat.starts_with('/') && raw_pat.ends_with('/') && raw_pat.len() >= 2 {
                    raw_pat[1..raw_pat.len() - 1].replace("\\/", "/")
                } else {
                    raw_pat.trim_matches('"').to_string()
                };
                let pat = pat_owned.as_str();
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

    if let Some((lhs, rhs)) = split_awk_binary_once(s, " in ") {
        let key = eval_awk_array_key(&lhs, state);
        let arr_name = rhs.trim();
        let present = state
            .arrays
            .get(arr_name)
            .is_some_and(|m| m.contains_key(&key));
        return if present { "1".to_string() } else { "0".to_string() };
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
    if let Some((lhs, rhs)) = split_awk_binary_once(s, "^") {
        let ln = parse_awk_f64(&eval_awk_expr(&lhs, state));
        let rn = parse_awk_f64(&eval_awk_expr(&rhs, state));
        return format_awk_num(ln.powf(rn));
    }

    if let Some(inner) = s.strip_prefix('!') {
        return if is_awk_truthy(&eval_awk_expr(inner, state)) {
            "0".to_string()
        } else {
            "1".to_string()
        };
    }

    if s.starts_with('(') && s.ends_with(')') && is_awk_outer_parens(s) {
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
            let key = eval_awk_array_key(key_expr, state);
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
            let key = eval_awk_array_key(&lv[open + 1..lv.len() - 1], state);
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
            if let Some(first) = args.first() {
                let trimmed = first.trim();
                if let Some(arr) = state.arrays.get(trimmed) {
                    return Some(arr.len().to_string());
                }
            }
            let target = if args.is_empty() {
                state.line.clone()
            } else {
                eval_awk_expr(&args[0], state)
            };
            Some(target.len().to_string())
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
            let bytes = text.as_bytes();
            if start >= bytes.len() {
                return Some(String::new());
            }
            if args.len() >= 3 {
                let len = eval_awk_expr(&args[2], state).parse::<usize>().unwrap_or(0);
                let end = (start + len).min(bytes.len());
                Some(crate::vfs::bytes_to_stream_string(&bytes[start..end]))
            } else {
                Some(crate::vfs::bytes_to_stream_string(&bytes[start..]))
            }
        }
        "index" => {
            if args.len() < 2 {
                return Some("0".to_string());
            }
            let hay = eval_awk_expr(&args[0], state);
            let needle = eval_awk_expr(&args[1], state);
            match hay.find(&needle) {
                Some(byte_idx) => Some((byte_idx + 1).to_string()),
                None => Some("0".to_string()),
            }
        }
        "match" => {
            if args.len() < 2 {
                state.set_var("RSTART", "0".to_string());
                state.set_var("RLENGTH", "-1".to_string());
                return Some("0".to_string());
            }
            let hay = eval_awk_expr(&args[0], state);
            let raw_pat = args[1].trim();
            let pat = if raw_pat.starts_with('/') && raw_pat.ends_with('/') && raw_pat.len() >= 2 {
                raw_pat[1..raw_pat.len() - 1].to_string()
            } else {
                eval_awk_expr(raw_pat, state)
            };
            if let Some(arr_arg) = args.get(2) {
                state.arrays.entry(arr_arg.trim().to_string()).or_default().clear();
            }
            let rx = ZeroRegex::new(vec![pat.clone()], false, false, false, false);
            if let Some((st, en)) = rx.find_all(&hay).into_iter().next() {
                let rstart = st + 1;
                let rlen = en - st;
                state.set_var("RSTART", rstart.to_string());
                state.set_var("RLENGTH", rlen.to_string());
                if let Some(arr_arg) = args.get(2) {
                    let arr_name = arr_arg.trim().to_string();
                    let caps = crate::commands::search::regex_captures(&pat, &hay, false)
                        .unwrap_or_else(|| vec![hay[st..en].to_string()]);
                    let map = state.arrays.entry(arr_name).or_default();
                    for (idx, cap) in caps.into_iter().enumerate() {
                        map.insert(idx.to_string(), cap);
                    }
                }
                Some(rstart.to_string())
            } else {
                state.set_var("RSTART", "0".to_string());
                state.set_var("RLENGTH", "-1".to_string());
                Some("0".to_string())
            }
        }
        "split" => {
            if args.len() < 2 {
                return Some("0".to_string());
            }
            let text = eval_awk_expr(&args[0], state);
            let arr_name = args[1].trim().to_string();
            let raw_sep = args.get(2).map(|a| a.trim()).unwrap_or("");
            let (sep, is_rx) = if raw_sep.starts_with('/') && raw_sep.ends_with('/') && raw_sep.len() >= 2 {
                (raw_sep[1..raw_sep.len() - 1].to_string(), true)
            } else if args.len() >= 3 {
                let v = eval_awk_expr(&args[2], state);
                let rx = v.len() > 1;
                (v, rx)
            } else {
                let v = state.fs.clone();
                let rx = v.len() > 1;
                (v, rx)
            };
            let (parts, seps): (Vec<String>, Vec<String>) = if text.is_empty() {
                (Vec::new(), Vec::new())
            } else if sep.is_empty() {
                (text.chars().map(|c| c.to_string()).collect(), Vec::new())
            } else if sep == " " {
                let mut p_vec = Vec::new();
                let mut s_vec = Vec::new();
                let trimmed = text.trim_matches(|c: char| c.is_ascii_whitespace());
                if !trimmed.is_empty() {
                    let mut cur_tok = String::new();
                    let mut cur_sep = String::new();
                    let mut in_ws = false;
                    for ch in trimmed.chars() {
                        if ch.is_ascii_whitespace() {
                            if !in_ws {
                                p_vec.push(std::mem::take(&mut cur_tok));
                                in_ws = true;
                            }
                            cur_sep.push(ch);
                        } else {
                            if in_ws {
                                s_vec.push(std::mem::take(&mut cur_sep));
                                in_ws = false;
                            }
                            cur_tok.push(ch);
                        }
                    }
                    p_vec.push(cur_tok);
                }
                (p_vec, s_vec)
            } else if is_rx {
                let rx = ZeroRegex::new(vec![sep], false, false, false, false);
                let spans = rx.find_all(&text);
                let mut res = Vec::new();
                let mut sep_res = Vec::new();
                let mut last = 0usize;
                for (st, en) in spans {
                    if st >= last && en > st {
                        res.push(text[last..st].to_string());
                        sep_res.push(text[st..en].to_string());
                        last = en;
                    }
                }
                res.push(text[last..].to_string());
                (res, sep_res)
            } else {
                let p_vec: Vec<String> = text.split(&sep).map(|p| p.to_string()).collect();
                let s_vec = if p_vec.len() > 1 {
                    vec![sep.clone(); p_vec.len() - 1]
                } else {
                    Vec::new()
                };
                (p_vec, s_vec)
            };
            let map = state.arrays.entry(arr_name).or_default();
            map.clear();
            for (i, p) in parts.iter().enumerate() {
                map.insert((i + 1).to_string(), p.clone());
            }
            if let Some(seps_arg) = args.get(3) {
                let seps_name = seps_arg.trim().to_string();
                let seps_map = state.arrays.entry(seps_name).or_default();
                seps_map.clear();
                for (i, s) in seps.iter().enumerate() {
                    seps_map.insert((i + 1).to_string(), s.clone());
                }
            }
            Some(parts.len().to_string())
        }
        "gensub" => {
            if args.len() < 3 {
                return Some(String::new());
            }
            let raw_pat = args[0].trim();
            let pat = if raw_pat.starts_with('/') && raw_pat.ends_with('/') && raw_pat.len() >= 2 {
                raw_pat[1..raw_pat.len() - 1].to_string()
            } else {
                eval_awk_expr(raw_pat, state)
            };
            let repl = eval_awk_expr(&args[1], state);
            let how = eval_awk_expr(&args[2], state);
            let target = args
                .get(3)
                .map(|a| eval_awk_expr(a, state))
                .unwrap_or_else(|| state.get_field(0));
            let global = how.starts_with('g') || how.starts_with('G');
            let nth = if global {
                None
            } else {
                Some((parse_awk_f64(&how) as isize).max(1) as usize)
            };
            let (updated, _) = replace_regex_count_in_text(&target, &pat, &repl, false, global, nth);
            Some(updated)
        }
        "strtonum" => {
            let s = args
                .first()
                .map(|a| eval_awk_expr(a, state))
                .unwrap_or_default();
            let trimmed = s.trim_start();
            let (sign, rest) = if let Some(r) = trimmed.strip_prefix('-') {
                (-1.0, r)
            } else if let Some(r) = trimmed.strip_prefix('+') {
                (1.0, r)
            } else {
                (1.0, trimmed)
            };
            let val = if let Some(hex_part) = rest.strip_prefix("0x").or_else(|| rest.strip_prefix("0X")) {
                let hex_digits: String = hex_part.chars().take_while(|c| c.is_ascii_hexdigit()).collect();
                u64::from_str_radix(&hex_digits, 16).unwrap_or(0) as f64 * sign
            } else if rest.starts_with('0') && rest.len() > 1 && rest[1..].chars().next().is_some_and(|c| ('0'..='7').contains(&c)) {
                let oct_digits: String = rest.chars().take_while(|c| ('0'..='7').contains(c)).collect();
                u64::from_str_radix(&oct_digits, 8).unwrap_or(0) as f64 * sign
            } else {
                parse_awk_f64(trimmed)
            };
            Some(format_awk_num(val))
        }
        "asort" | "asorti" => {
            if args.is_empty() {
                return Some("0".to_string());
            }
            let src_name = args[0].trim().to_string();
            let dst_name = args
                .get(1)
                .map(|a| a.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| src_name.clone());
            let mut items: Vec<String> = state
                .arrays
                .get(&src_name)
                .map(|m| {
                    if fn_name == "asorti" {
                        m.keys().cloned().collect()
                    } else {
                        m.values().cloned().collect()
                    }
                })
                .unwrap_or_default();
            items.sort_by(|a, b| match (a.trim().parse::<f64>(), b.trim().parse::<f64>()) {
                (Ok(na), Ok(nb)) => na
                    .partial_cmp(&nb)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.cmp(b)),
                _ => a.cmp(b),
            });
            let n = items.len();
            let dst = state.arrays.entry(dst_name).or_default();
            dst.clear();
            for (i, item) in items.into_iter().enumerate() {
                dst.insert((i + 1).to_string(), item);
            }
            Some(n.to_string())
        }
        "and" => {
            if args.is_empty() {
                return Some("0".to_string());
            }
            let mut acc = parse_awk_f64(&eval_awk_expr(&args[0], state)) as u64;
            for a in &args[1..] {
                acc &= parse_awk_f64(&eval_awk_expr(a, state)) as u64;
            }
            Some(acc.to_string())
        }
        "or" => {
            let mut acc = 0u64;
            for a in &args {
                acc |= parse_awk_f64(&eval_awk_expr(a, state)) as u64;
            }
            Some(acc.to_string())
        }
        "xor" => {
            let mut acc = 0u64;
            for a in &args {
                acc ^= parse_awk_f64(&eval_awk_expr(a, state)) as u64;
            }
            Some(acc.to_string())
        }
        "lshift" => {
            let v = args.first().map(|a| parse_awk_f64(&eval_awk_expr(a, state)) as u64).unwrap_or(0);
            let sh = args.get(1).map(|a| parse_awk_f64(&eval_awk_expr(a, state)) as u32).unwrap_or(0);
            Some(v.wrapping_shl(sh).to_string())
        }
        "rshift" => {
            let v = args.first().map(|a| parse_awk_f64(&eval_awk_expr(a, state)) as u64).unwrap_or(0);
            let sh = args.get(1).map(|a| parse_awk_f64(&eval_awk_expr(a, state)) as u32).unwrap_or(0);
            Some(v.wrapping_shr(sh).to_string())
        }
        "compl" => {
            let v = args.first().map(|a| parse_awk_f64(&eval_awk_expr(a, state)) as u64).unwrap_or(0);
            Some(((!v) & ((1u64 << 53) - 1)).to_string())
        }
        "sub" | "gsub" => {
            if args.len() < 2 {
                return Some("0".to_string());
            }
            let raw_pat = args[0].trim();
            let pat = if raw_pat.starts_with('/') && raw_pat.ends_with('/') && raw_pat.len() >= 2 {
                raw_pat[1..raw_pat.len() - 1].replace("\\/", "/")
            } else {
                eval_awk_expr(raw_pat, state)
            };
            let repl = eval_awk_expr(&args[1], state);
            let target_lval = args.get(2).map(|s| s.as_str()).unwrap_or("$0");
            let current = eval_awk_expr(target_lval, state);
            let (updated, count) =
                replace_regex_count_in_text(&current, &pat, &repl, false, fn_name == "gsub", None);
            assign_awk_lvalue(target_lval, updated, state);
            Some(count.to_string())
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
        "atan2" => {
            let y = args
                .first()
                .map(|a| parse_awk_f64(&eval_awk_expr(a, state)))
                .unwrap_or(0.0);
            let x = args
                .get(1)
                .map(|a| parse_awk_f64(&eval_awk_expr(a, state)))
                .unwrap_or(0.0);
            Some(format_awk_num(y.atan2(x)))
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
        "close" => {
            if let Some(arg) = args.first() {
                let path = eval_awk_expr(arg, state);
                let full = resolve_posix_path(&state.cwd, &path);
                state.getline_files.remove(&full);
            }
            Some("0".to_string())
        }
        "ord" => {
            let s = args.first().map(|a| eval_awk_expr(a, state)).unwrap_or_default();
            let code = s.chars().next().map(|c| c as u32).unwrap_or(0);
            Some(code.to_string())
        }
        "chr" => {
            let n = args
                .first()
                .map(|a| parse_awk_f64(&eval_awk_expr(a, state)) as u32)
                .unwrap_or(0);
            let ch = char::from_u32(n).map(|c| c.to_string()).unwrap_or_default();
            Some(ch)
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
                let caller_idents: Vec<Option<String>> = (0..params.len())
                    .map(|idx| {
                        args.get(idx)
                            .map(|a| a.trim())
                            .filter(|s| {
                                !s.is_empty()
                                    && s.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                                    && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                            })
                            .map(|s| s.to_string())
                    })
                    .collect();
                let passed_arrays: Vec<Option<BTreeMap<String, String>>> = caller_idents
                    .iter()
                    .map(|ci_opt| ci_opt.as_ref().and_then(|ci| state.arrays.get(ci).cloned()))
                    .collect();
                let arg_vals: Vec<String> =
                    args.iter().map(|a| eval_awk_expr(a, state)).collect();
                let mut saved_vars: Vec<(String, Option<String>)> = Vec::new();
                let mut saved_arrays: Vec<(String, Option<BTreeMap<String, String>>)> = Vec::new();
                for (idx, p) in params.iter().enumerate() {
                    saved_vars.push((p.clone(), state.vars.get(p).cloned()));
                    saved_arrays.push((p.clone(), state.arrays.remove(p)));
                    if let Some(Some(arr)) = passed_arrays.get(idx) {
                        state.arrays.insert(p.clone(), arr.clone());
                    }
                    let val = arg_vals.get(idx).cloned().unwrap_or_default();
                    state.vars.insert(p.clone(), val);
                }
                let prev_ret = state.return_val.take();
                exec_awk_block(&body, state);
                let ret = state.return_val.take().unwrap_or_default();
                state.return_val = prev_ret;
                let mut writeback_arrays: Vec<(String, BTreeMap<String, String>)> = Vec::new();
                for (idx, p) in params.iter().enumerate() {
                    if let Some(Some(ci)) = caller_idents.get(idx)
                        && let Some(mod_arr) = state.arrays.remove(p)
                    {
                        writeback_arrays.push((ci.clone(), mod_arr));
                    }
                }
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
                for (ci, mod_arr) in writeback_arrays {
                    state.arrays.insert(ci, mod_arr);
                }
                return Some(ret);
            }
            None
        }
    }
}

fn split_awk_redirection(s: &str) -> (String, Option<(bool, String)>) {
    if let Some((lhs, rhs)) = split_awk_binary_once(s, ">>") {
        return (lhs, Some((true, rhs.trim().to_string())));
    }
    if let Some((lhs, rhs)) = split_awk_binary_once(s, ">") {
        return (lhs, Some((false, rhs.trim().to_string())));
    }
    (s.to_string(), None)
}

fn split_awk_binary_once(s: &str, op: &str) -> Option<(String, String)> {
    let chars: Vec<char> = s.chars().collect();
    let op_chars: Vec<char> = op.chars().collect();
    let mut quote = false;
    let mut in_rx = false;
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut i = 0usize;

    while i + op_chars.len() <= chars.len() {
        let c = chars[i];
        if c == '\\' {
            i += 2;
            continue;
        }
        if c == '"' && !in_rx {
            quote = !quote;
            i += 1;
            continue;
        }
        if !quote && c == '/' {
            if in_rx {
                in_rx = false;
                i += 1;
                continue;
            } else if awk_chars_allow_regex(&chars, i) {
                in_rx = true;
                i += 1;
                continue;
            }
        }
        if !quote && !in_rx {
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
    let mut in_rx = false;
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
        if c == '"' && !in_rx {
            quote = !quote;
            i += 1;
            continue;
        }
        if !quote && c == '/' {
            if in_rx {
                in_rx = false;
                i += 1;
                continue;
            } else if awk_chars_allow_regex(&chars, i) {
                in_rx = true;
                i += 1;
                continue;
            }
        }
        if !quote && !in_rx {
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
    let mut in_rx = false;
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
        if c == '"' && !in_rx {
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
        if !quote && c == '/' {
            if in_rx {
                in_rx = false;
                cur.push(c);
                i += 1;
                continue;
            } else if awk_chars_allow_regex(&chars, i) {
                in_rx = true;
                cur.push(c);
                i += 1;
                continue;
            }
        }
        if !quote && !in_rx {
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
            while i < chars.len() && !matches!(chars[i], 's' | 'd' | 'i' | 'u' | 'f' | 'e' | 'E' | 'g' | 'G' | 'x' | 'X' | 'o' | 'c') {
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
                'd' | 'i' | 'u' => {
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
                    apply_width_spec(&format!("{n:x}"), &spec, true)
                }
                'X' => {
                    let n = val.parse::<f64>().unwrap_or(0.0) as i64;
                    apply_width_spec(&format!("{n:X}"), &spec, true)
                }
                'o' => {
                    let n = val.parse::<f64>().unwrap_or(0.0) as i64;
                    apply_width_spec(&format!("{n:o}"), &spec, true)
                }
                'c' => {
                    let ch_str = if let Ok(n) = val.parse::<u32>() {
                        char::from_u32(n).map(|c| c.to_string()).unwrap_or_default()
                    } else {
                        val.chars().next().map(|c| c.to_string()).unwrap_or_default()
                    };
                    apply_width_spec(&ch_str, &spec, false)
                }
                _ => {
                    let truncated = if let Some((_, p)) = spec.split_once('.') {
                        if let Ok(prec) = p.parse::<usize>() {
                            val.chars().take(prec).collect::<String>()
                        } else {
                            val.clone()
                        }
                    } else {
                        val.clone()
                    };
                    apply_width_spec(&truncated, &spec, false)
                }
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
    let before_dot = spec.split('.').next().unwrap_or("");
    let mut left_align = false;
    let mut force_sign = false;
    let mut zero_pad = false;
    let mut width_digits = String::new();
    for ch in before_dot.chars() {
        if width_digits.is_empty() {
            match ch {
                '-' => left_align = true,
                '+' => force_sign = true,
                '0' => zero_pad = true,
                '1'..='9' => width_digits.push(ch),
                _ => {}
            }
        } else if ch.is_ascii_digit() {
            width_digits.push(ch);
        }
    }
    if left_align || !is_num {
        zero_pad = false;
    }
    let signed_val = if is_num && force_sign && !val.starts_with('-') && !val.starts_with('+') {
        format!("+{val}")
    } else {
        val.to_string()
    };
    let width = width_digits.parse::<usize>().unwrap_or(0);
    let len = signed_val.chars().count();
    if width <= len {
        return signed_val;
    }
    let pad_len = width - len;
    if left_align {
        format!("{signed_val}{}", " ".repeat(pad_len))
    } else if zero_pad {
        if let Some(rest) = signed_val.strip_prefix('-') {
            format!("-{}{rest}", "0".repeat(pad_len))
        } else if let Some(rest) = signed_val.strip_prefix('+') {
            format!("+{}{rest}", "0".repeat(pad_len))
        } else {
            format!("{}{signed_val}", "0".repeat(pad_len))
        }
    } else {
        format!("{}{signed_val}", " ".repeat(pad_len))
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
    SideBySide,
    Ifdef,
}

#[derive(Clone, Default)]
struct DiffOpts {
    format: Option<DiffFormat>,
    ctx_lines: Option<usize>,
    new_file: bool,
    unidir_new_file: bool,
    brief: bool,
    report_identical: bool,
    ignore_case: bool,
    ignore_all_space: bool,
    ignore_blank_lines: bool,
    suppress_common: bool,
    no_deref: bool,
    show_c_func: bool,
    ifdef_macro: String,
    labels: Vec<String>,
    ignore_regexes: Vec<String>,
    excludes: Vec<String>,
}

fn diff_glob_matches(pat: &str, name: &str) -> bool {
    if pat == name {
        return true;
    }
    if let Some(suf) = pat.strip_prefix('*') {
        return name.ends_with(suf);
    }
    if let Some(pre) = pat.strip_suffix('*') {
        return name.starts_with(pre);
    }
    false
}

#[allow(clippy::too_many_arguments)]
fn diff_two_texts(
    label_a: &str,
    label_b: &str,
    text_a: &str,
    text_b: &str,
    opts: &DiffOpts,
) -> (String, bool) {
    let format = opts.format.unwrap_or(DiffFormat::Normal);
    let brief = opts.brief;
    let report_identical = opts.report_identical;
    let ignore_case = opts.ignore_case;
    let ignore_all_space = opts.ignore_all_space;
    let ignore_blank_lines = opts.ignore_blank_lines;

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

    let edits = compute_lcs_edits(&norm_a, &norm_b);
    if !opts.ignore_regexes.is_empty() {
        let rx = ZeroRegex::new(opts.ignore_regexes.clone(), ignore_case, false, false, false);
        let all_ignored = edits.iter().all(|e| match e {
            DiffEdit::Keep(_) => true,
            DiffEdit::Delete(ia) => rx.is_match(lines_a[*ia]),
            DiffEdit::Insert(ib) => rx.is_match(lines_b[*ib]),
        });
        if all_ignored {
            if report_identical {
                return (format!("Files {label_a} and {label_b} are identical\n"), false);
            }
            return (String::new(), false);
        }
    }

    if brief {
        return (format!("Files {label_a} and {label_b} differ\n"), true);
    }

    let mut out = String::new();
    if format == DiffFormat::Unified {
        out.push_str(&format!("--- {label_a}\n+++ {label_b}\n"));
        let ctx = opts.ctx_lines.unwrap_or(3);
        let last_a = lines_a.len().saturating_sub(1);
        let last_b = lines_b.len().saturating_sub(1);

        let mut tagged: Vec<(DiffEdit, usize, usize)> = Vec::with_capacity(edits.len());
        let mut ca = 0usize;
        let mut cb = 0usize;
        for e in edits {
            match e {
                DiffEdit::Keep(ia) => {
                    tagged.push((DiffEdit::Keep(ia), ia, cb));
                    ca = ia + 1;
                    cb += 1;
                }
                DiffEdit::Delete(ia) => {
                    tagged.push((DiffEdit::Delete(ia), ia, cb));
                    ca = ia + 1;
                }
                DiffEdit::Insert(ib) => {
                    tagged.push((DiffEdit::Insert(ib), ca, ib));
                    cb = ib + 1;
                }
            }
        }

        let mut change_runs: Vec<(usize, usize)> = Vec::new();
        let mut idx = 0usize;
        while idx < tagged.len() {
            if matches!(tagged[idx].0, DiffEdit::Keep(_)) {
                idx += 1;
                continue;
            }
            let s = idx;
            while idx < tagged.len() && !matches!(tagged[idx].0, DiffEdit::Keep(_)) {
                idx += 1;
            }
            change_runs.push((s, idx - 1));
        }

        let mut hunk_ranges: Vec<(usize, usize)> = Vec::new();
        if change_runs.is_empty() && !tagged.is_empty() {
            hunk_ranges.push((0, tagged.len() - 1));
        } else {
            for (cs, ce) in change_runs {
                let hs = cs.saturating_sub(ctx);
                let he = (ce + ctx).min(tagged.len().saturating_sub(1));
                if let Some(last) = hunk_ranges.last_mut()
                    && hs <= last.1 + 1
                {
                    last.1 = he;
                } else {
                    hunk_ranges.push((hs, he));
                }
            }
        }

        for (hs, he) in hunk_ranges {
            let slice = &tagged[hs..=he];
            let old_count = slice
                .iter()
                .filter(|(e, _, _)| matches!(e, DiffEdit::Keep(_) | DiffEdit::Delete(_)))
                .count();
            let new_count = slice
                .iter()
                .filter(|(e, _, _)| matches!(e, DiffEdit::Keep(_) | DiffEdit::Insert(_)))
                .count();
            let old_start = slice
                .iter()
                .find_map(|(e, ia, _)| match e {
                    DiffEdit::Keep(_) | DiffEdit::Delete(_) => Some(*ia + 1),
                    _ => None,
                })
                .unwrap_or(if old_count == 0 { 0 } else { 1 });
            let new_start = slice
                .iter()
                .find_map(|(e, _, ib)| match e {
                    DiffEdit::Keep(_) | DiffEdit::Insert(_) => Some(*ib + 1),
                    _ => None,
                })
                .unwrap_or(if new_count == 0 { 0 } else { 1 });
            let func_heading = if opts.show_c_func {
                lines_a
                    .iter()
                    .take(old_start.max(1))
                    .rev()
                    .find(|l| {
                        !l.is_empty()
                            && !l.starts_with(' ')
                            && !l.starts_with('\t')
                            && l.contains('(')
                    })
                    .or_else(|| {
                        lines_a.iter().find(|l| {
                            !l.is_empty()
                                && !l.starts_with(' ')
                                && !l.starts_with('\t')
                                && l.contains('(')
                        })
                    })
                    .map(|l| format!(" {}", l.trim()))
                    .unwrap_or_default()
            } else {
                String::new()
            };
            out.push_str(&format!(
                "@@ -{old_start},{old_count} +{new_start},{new_count} @@{func_heading}\n"
            ));
            for (edit, ia, ib) in slice {
                match *edit {
                    DiffEdit::Keep(ia_idx) => {
                        out.push_str(&format!(" {}\n", lines_a[ia_idx]));
                        if ia_idx == last_a && *ib == last_b && (a_no_nl || b_no_nl) {
                            out.push_str("\\ No newline at end of file\n");
                        }
                    }
                    DiffEdit::Delete(ia_idx) => {
                        out.push_str(&format!("-{}\n", lines_a[ia_idx]));
                        if ia_idx == last_a && a_no_nl {
                            out.push_str("\\ No newline at end of file\n");
                        }
                    }
                    DiffEdit::Insert(ib_idx) => {
                        let _ = ia;
                        out.push_str(&format!("+{}\n", lines_b[ib_idx]));
                        if ib_idx == last_b && b_no_nl {
                            out.push_str("\\ No newline at end of file\n");
                        }
                    }
                }
            }
        }
    } else if format == DiffFormat::Context {
        out.push_str(&format!("*** {label_a}\n--- {label_b}\n***************\n"));
        out.push_str(&format!("*** 1,{} ****\n", lines_a.len()));
        let mut ei = 0usize;
        while ei < edits.len() {
            match edits[ei] {
                DiffEdit::Keep(ia) => {
                    out.push_str(&format!("  {}\n", lines_a[ia]));
                    ei += 1;
                }
                DiffEdit::Delete(ia) => {
                    let has_ins = ei + 1 < edits.len() && matches!(edits[ei + 1], DiffEdit::Insert(_));
                    let prefix = if has_ins { "!" } else { "-" };
                    out.push_str(&format!("{prefix} {}\n", lines_a[ia]));
                    ei += 1;
                }
                DiffEdit::Insert(_) => {
                    ei += 1;
                }
            }
        }
        out.push_str(&format!("--- 1,{} ----\n", lines_b.len()));
        let mut ei2 = 0usize;
        while ei2 < edits.len() {
            match edits[ei2] {
                DiffEdit::Keep(ia) => {
                    out.push_str(&format!("  {}\n", lines_a[ia]));
                    ei2 += 1;
                }
                DiffEdit::Delete(_) => {
                    ei2 += 1;
                }
                DiffEdit::Insert(ib) => {
                    let had_del = ei2 > 0 && matches!(edits[ei2 - 1], DiffEdit::Delete(_));
                    let prefix = if had_del { "!" } else { "+" };
                    out.push_str(&format!("{prefix} {}\n", lines_b[ib]));
                    ei2 += 1;
                }
            }
        }
    } else if format == DiffFormat::SideBySide {
        let mut ei = 0usize;
        while ei < edits.len() {
            match edits[ei] {
                DiffEdit::Keep(ia) => {
                    if !opts.suppress_common {
                        out.push_str(&format!("{:<16}   {}\n", lines_a[ia], lines_a[ia]));
                    }
                    ei += 1;
                }
                DiffEdit::Delete(ia) => {
                    if ei + 1 < edits.len()
                        && let DiffEdit::Insert(ib) = edits[ei + 1]
                    {
                        out.push_str(&format!("{:<16} | {}\n", lines_a[ia], lines_b[ib]));
                        ei += 2;
                    } else {
                        out.push_str(&format!("{:<16} <\n", lines_a[ia]));
                        ei += 1;
                    }
                }
                DiffEdit::Insert(ib) => {
                    out.push_str(&format!("{:<16} > {}\n", "", lines_b[ib]));
                    ei += 1;
                }
            }
        }
    } else if format == DiffFormat::Ifdef {
        let m = &opts.ifdef_macro;
        let mut ei = 0usize;
        while ei < edits.len() {
            match edits[ei] {
                DiffEdit::Keep(ia) => {
                    out.push_str(&format!("{}\n", lines_a[ia]));
                    ei += 1;
                }
                DiffEdit::Delete(_) | DiffEdit::Insert(_) => {
                    let mut dels = Vec::new();
                    let mut inss = Vec::new();
                    while ei < edits.len() {
                        match edits[ei] {
                            DiffEdit::Keep(_) => break,
                            DiffEdit::Delete(ia) => dels.push(lines_a[ia]),
                            DiffEdit::Insert(ib) => inss.push(lines_b[ib]),
                        }
                        ei += 1;
                    }
                    if !dels.is_empty() && !inss.is_empty() {
                        out.push_str(&format!("#ifndef {m}\n"));
                        for d in dels {
                            out.push_str(&format!("{d}\n"));
                        }
                        out.push_str("#else\n");
                        for ins in inss {
                            out.push_str(&format!("{ins}\n"));
                        }
                        out.push_str("#endif\n");
                    } else if !dels.is_empty() {
                        out.push_str(&format!("#ifndef {m}\n"));
                        for d in dels {
                            out.push_str(&format!("{d}\n"));
                        }
                        out.push_str("#endif\n");
                    } else if !inss.is_empty() {
                        out.push_str(&format!("#ifdef {m}\n"));
                        for ins in inss {
                            out.push_str(&format!("{ins}\n"));
                        }
                        out.push_str("#endif\n");
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
    opts: &DiffOpts,
    fs: &dyn SafeBashFs,
    out: &mut String,
    any_diff: &mut bool,
) {
    let new_file = opts.new_file;
    let unidir_new_file = opts.unidir_new_file;
    let mut set = std::collections::BTreeSet::new();
    for n in fs.list_dir(full_a).unwrap_or_default() {
        set.insert(n);
    }
    for n in fs.list_dir(full_b).unwrap_or_default() {
        set.insert(n);
    }
    for name in set {
        if opts.excludes.iter().any(|p| diff_glob_matches(p, &name)) {
            continue;
        }
        let ca = if full_a == "/" { format!("/{name}") } else { format!("{full_a}/{name}") };
        let cb = if full_b == "/" { format!("/{name}") } else { format!("{full_b}/{name}") };
        let da = format!("{}/{name}", disp_a.trim_end_matches('/'));
        let db = format!("{}/{name}", disp_b.trim_end_matches('/'));
        let sym_a = fs.readlink(&ca).ok();
        let sym_b = fs.readlink(&cb).ok();
        if opts.no_deref && (sym_a.is_some() || sym_b.is_some()) {
            if sym_a != sym_b {
                *any_diff = true;
                out.push_str(&format!("Symbolic links {da} and {db} differ\n"));
            }
            continue;
        }
        let ex_a = fs.exists(&ca) || sym_a.is_some();
        let ex_b = fs.exists(&cb) || sym_b.is_some();
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
            if new_file || unidir_new_file {
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
                opts,
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
                opts,
            );
            if differed {
                *any_diff = true;
            }
            out.push_str(&d_out);
        }
    }
}

fn cmd_diff(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut opts = DiffOpts::default();
    let mut from_file: Option<String> = None;
    let mut to_file: Option<String> = None;
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        match a.as_str() {
            "-u" | "--unified" => opts.format = Some(DiffFormat::Unified),
            "-c" | "--context" => opts.format = Some(DiffFormat::Context),
            "-e" | "--ed" => opts.format = Some(DiffFormat::Ed),
            "-n" | "--rcs" => opts.format = Some(DiffFormat::Rcs),
            "-y" | "--side-by-side" => opts.format = Some(DiffFormat::SideBySide),
            "--suppress-common-lines" => opts.suppress_common = true,
            "--no-dereference" => opts.no_deref = true,
            "-p" | "--show-c-function" => opts.show_c_func = true,
            "-N" | "--new-file" => opts.new_file = true,
            "-P" | "--unidirectional-new-file" => opts.unidir_new_file = true,
            "-q" | "--brief" => opts.brief = true,
            "-s" | "--report-identical-files" => opts.report_identical = true,
            "-i" | "--ignore-case" => opts.ignore_case = true,
            "-w" | "-b" | "-E" | "-Z" | "-t" | "--ignore-all-space" | "--ignore-space-change" => {
                opts.ignore_all_space = true;
            }
            "-B" | "--ignore-blank-lines" => opts.ignore_blank_lines = true,
            "-r" | "--recursive" => {}
            "-U" if i + 1 < args.len() => {
                opts.format = Some(DiffFormat::Unified);
                i += 1;
                opts.ctx_lines = args[i].parse().ok();
            }
            "-C" if i + 1 < args.len() => {
                opts.format = Some(DiffFormat::Context);
                i += 1;
                opts.ctx_lines = args[i].parse().ok();
            }
            "-W" | "-F" | "-S" if i + 1 < args.len() => {
                i += 1;
            }
            "-D" if i + 1 < args.len() => {
                opts.format = Some(DiffFormat::Ifdef);
                i += 1;
                opts.ifdef_macro = args[i].clone();
            }
            "-L" | "--label" if i + 1 < args.len() => {
                i += 1;
                opts.labels.push(args[i].clone());
            }
            "-I" | "--ignore-matching-lines" if i + 1 < args.len() => {
                i += 1;
                opts.ignore_regexes.push(args[i].clone());
            }
            "-x" | "--exclude" if i + 1 < args.len() => {
                i += 1;
                opts.excludes.push(args[i].clone());
            }
            _ if a.starts_with("--label=") => {
                opts.labels.push(a["--label=".len()..].to_string());
            }
            _ if a.starts_with("--ignore-matching-lines=") => {
                opts.ignore_regexes
                    .push(a["--ignore-matching-lines=".len()..].to_string());
            }
            _ if a.starts_with("--exclude=") => {
                opts.excludes.push(a["--exclude=".len()..].to_string());
            }
            _ if a.starts_with("--from-file=") => {
                from_file = Some(a["--from-file=".len()..].to_string());
            }
            _ if a.starts_with("--to-file=") => {
                to_file = Some(a["--to-file=".len()..].to_string());
            }
            _ if a.starts_with("-U") || a.starts_with("--unified=") => {
                opts.format = Some(DiffFormat::Unified);
                let num = a
                    .strip_prefix("--unified=")
                    .or_else(|| a.strip_prefix("-U"))
                    .unwrap_or("");
                opts.ctx_lines = num.parse().ok();
            }
            _ if a.starts_with("-C") || a.starts_with("--context=") => {
                opts.format = Some(DiffFormat::Context);
                let num = a
                    .strip_prefix("--context=")
                    .or_else(|| a.strip_prefix("-C"))
                    .unwrap_or("");
                opts.ctx_lines = num.parse().ok();
            }
            _ if a.starts_with('-') && a != "-" => {
                for ch in a[1..].chars() {
                    match ch {
                        'u' => opts.format = Some(DiffFormat::Unified),
                        'c' => opts.format = Some(DiffFormat::Context),
                        'e' => opts.format = Some(DiffFormat::Ed),
                        'n' => opts.format = Some(DiffFormat::Rcs),
                        'y' => opts.format = Some(DiffFormat::SideBySide),
                        'N' => opts.new_file = true,
                        'P' => opts.unidir_new_file = true,
                        'q' => opts.brief = true,
                        's' => opts.report_identical = true,
                        'i' => opts.ignore_case = true,
                        'w' | 'b' | 'E' | 'Z' | 't' => opts.ignore_all_space = true,
                        'B' => opts.ignore_blank_lines = true,
                        'p' => opts.show_c_func = true,
                        _ => {}
                    }
                }
            }
            _ => files.push(a.clone()),
        }
        i += 1;
    }

    if let Some(ff) = from_file {
        let mut pairs = Vec::new();
        for f in &files {
            pairs.push((ff.clone(), f.clone()));
        }
        let mut total_out = String::new();
        let mut any_diff = false;
        for (fa, fb) in pairs {
            let ta = fs
                .read_file(&resolve_posix_path(cwd, &fa))
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .unwrap_or_default();
            let tb = fs
                .read_file(&resolve_posix_path(cwd, &fb))
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .unwrap_or_default();
            let (o, d) = diff_two_texts(&fa, &fb, &ta, &tb, &opts);
            if d {
                any_diff = true;
            }
            total_out.push_str(&o);
        }
        return BuiltinOutcome {
            stdout: total_out,
            stderr: String::new(),
            exit_code: if any_diff { 1 } else { 0 },
        };
    }
    if let Some(tf) = to_file
        && files.len() == 1
    {
        files.push(tf);
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
            &opts,
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
        opts.labels.first().unwrap_or(&files[0]),
        opts.labels.get(1).unwrap_or(&files[1]),
        &text_a,
        &text_b,
        &opts,
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

#[derive(Clone, Default)]
struct PatchOpts {
    strip: usize,
    reverse: bool,
    dry_run: bool,
    backup: bool,
    backup_suffix: String,
    remove_empty: bool,
    ignore_ws: bool,
    fuzz: usize,
    forward_only: bool,
    merge_mode: bool,
    merge_diff3: bool,
    atomic: bool,
    ifdef_guard: Option<String>,
    work_cwd: String,
}

fn convert_context_diff_to_unified(text: &str) -> String {
    if !text.contains("***************") {
        return text.to_string();
    }
    let mut out = String::new();
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0usize;
    while i < lines.len() {
        if let Some(a_hdr) = lines[i].strip_prefix("*** ")
            && !a_hdr.ends_with("****")
        {
            out.push_str(&format!("--- {a_hdr}\n"));
            if i + 1 < lines.len()
                && let Some(b_hdr) = lines[i + 1].strip_prefix("--- ")
                && !b_hdr.ends_with("----")
            {
                out.push_str(&format!("+++ {b_hdr}\n"));
                i += 2;
                continue;
            }
        }
        if lines[i] == "***************" {
            i += 1;
            if i < lines.len() && lines[i].starts_with("*** ") && lines[i].ends_with("****") {
                let a_range = lines[i]
                    .trim_start_matches('*')
                    .trim_end_matches('*')
                    .trim()
                    .to_string();
                i += 1;
                let mut old_part = Vec::new();
                while i < lines.len()
                    && !(lines[i].starts_with("--- ") && lines[i].ends_with("----"))
                    && lines[i] != "***************"
                {
                    old_part.push(lines[i]);
                    i += 1;
                }
                let mut b_range = a_range.clone();
                let mut new_part = Vec::new();
                if i < lines.len() && lines[i].starts_with("--- ") && lines[i].ends_with("----") {
                    b_range = lines[i]
                        .trim_start_matches('-')
                        .trim_end_matches('-')
                        .trim()
                        .to_string();
                    i += 1;
                    while i < lines.len()
                        && lines[i] != "***************"
                        && !lines[i].starts_with("*** ")
                    {
                        new_part.push(lines[i]);
                        i += 1;
                    }
                }
                out.push_str(&format!("@@ -{a_range} +{b_range} @@\n"));
                let mut oi = 0usize;
                let mut ni = 0usize;
                while oi < old_part.len() || ni < new_part.len() {
                    let ol = old_part.get(oi).copied().unwrap_or("");
                    let nl = new_part.get(ni).copied().unwrap_or("");
                    if let Some(c) = ol.strip_prefix("  ")
                        && nl.starts_with("  ")
                    {
                        out.push_str(&format!(" {c}\n"));
                        oi += 1;
                        ni += 1;
                    } else if let Some(d) = ol.strip_prefix("- ").or_else(|| ol.strip_prefix("! ")) {
                        out.push_str(&format!("-{d}\n"));
                        oi += 1;
                    } else if let Some(a) = nl.strip_prefix("+ ").or_else(|| nl.strip_prefix("! ")) {
                        out.push_str(&format!("+{a}\n"));
                        ni += 1;
                    } else if oi < old_part.len() {
                        if let Some(c) = ol.strip_prefix("  ") {
                            out.push_str(&format!(" {c}\n"));
                        }
                        oi += 1;
                    } else {
                        if let Some(c) = nl.strip_prefix("  ") {
                            out.push_str(&format!(" {c}\n"));
                        }
                        ni += 1;
                    }
                }
                continue;
            }
        }
        out.push_str(lines[i]);
        out.push('\n');
        i += 1;
    }
    out
}

fn cmd_patch(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut opts = PatchOpts {
        backup_suffix: ".orig".to_string(),
        work_cwd: cwd.to_string(),
        ..Default::default()
    };
    let mut silent = false;
    let mut input_file: Option<String> = None;
    let mut output_file: Option<String> = None;
    let mut reject_file: Option<String> = None;
    let mut target_file: Option<String> = None;

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-R" || a == "--reverse" {
            opts.reverse = true;
        } else if a == "-s" || a == "--silent" || a == "--quiet" {
            silent = true;
        } else if a == "--dry-run" {
            opts.dry_run = true;
        } else if a == "-b" || a == "--backup" {
            opts.backup = true;
        } else if a == "-E" || a == "--remove-empty-files" {
            opts.remove_empty = true;
        } else if a == "-l" || a == "--ignore-whitespace" {
            opts.ignore_ws = true;
        } else if a == "-N" || a == "--forward" {
            opts.forward_only = true;
        } else if a == "--atomic" {
            opts.atomic = true;
        } else if a == "--merge" || a == "--merge=diff3" || a == "--merge=merge" {
            opts.merge_mode = true;
            opts.merge_diff3 = a.ends_with("diff3");
        } else if let Some(m) = a.strip_prefix("--ifdef=") {
            opts.ifdef_guard = Some(m.to_string());
        } else if a == "-D" && i + 1 < args.len() {
            i += 1;
            opts.ifdef_guard = Some(args[i].clone());
        } else if (a == "-d" || a == "--directory") && i + 1 < args.len() {
            i += 1;
            opts.work_cwd = resolve_posix_path(cwd, &args[i]);
        } else if let Some(d) = a.strip_prefix("--directory=") {
            opts.work_cwd = resolve_posix_path(cwd, d);
        } else if (a == "-z" || a == "--suffix") && i + 1 < args.len() {
            i += 1;
            opts.backup_suffix = args[i].clone();
        } else if let Some(s) = a.strip_prefix("--suffix=") {
            opts.backup_suffix = s.to_string();
        } else if (a == "-F" || a == "--fuzz") && i + 1 < args.len() {
            i += 1;
            opts.fuzz = args[i].parse().unwrap_or(0);
        } else if let Some(f) = a.strip_prefix("--fuzz=") {
            opts.fuzz = f.parse().unwrap_or(0);
        } else if (a == "-V" || a == "--version-control") && i + 1 < args.len() {
            i += 1;
        } else if a == "-f" || a == "--force" || a == "-t" || a == "--batch" || a.starts_with("--reject-format") {
        } else if let Some(p) = a.strip_prefix("-p") {
            if !p.is_empty() {
                opts.strip = p.parse().unwrap_or(0);
            } else if i + 1 < args.len() {
                i += 1;
                opts.strip = args[i].parse().unwrap_or(0);
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
        } else if !a.starts_with('-') && input_file.is_none() {
            input_file = Some(a.clone());
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
    let normalized_patch = convert_context_diff_to_unified(&patch_text);

    match apply_unified_diff(
        &normalized_patch,
        target_file.as_deref(),
        output_file.as_deref(),
        reject_file.as_deref(),
        &opts,
        fs,
    ) {
        Ok(msg) => ok_out(if silent { "" } else { &msg }),
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
    opts: &PatchOpts,
    fs: &dyn SafeBashFs,
    staged_writes: &mut Option<StagedPatchWrites>,
) -> Result<(), String> {
    if opts.dry_run {
        return Ok(());
    }
    let cwd = &opts.work_cwd;
    let orig_full = resolve_posix_path(cwd, target);
    if opts.backup && output_override.is_none() && let Ok(orig_bytes) = fs.read_file(&orig_full) {
        let bak_path = format!("{orig_full}{}", opts.backup_suffix);
        if let Some(staged) = staged_writes {
            staged.push((bak_path, Some(orig_bytes)));
        } else {
            let _ = fs.write_file(&bak_path, &orig_bytes);
        }
    }
    let write_target = output_override.unwrap_or(target);
    let full = resolve_posix_path(cwd, write_target);
    if (delete_to_dev_null || opts.remove_empty) && file_lines.is_empty() {
        if let Some(staged) = staged_writes {
            staged.push((full, None));
        } else {
            let _ = fs.remove(&full, false);
        }
        return Ok(());
    }
    let content = if file_lines.is_empty() {
        String::new()
    } else if no_trailing_newline {
        file_lines.join("\n")
    } else {
        format!("{}\n", file_lines.join("\n"))
    };
    if let Some(staged) = staged_writes {
        staged.push((full, Some(content.into_bytes())));
        return Ok(());
    }
    let parent = crate::vfs::dirname_posix_path(&full);
    if !parent.is_empty() && parent != "/" && !fs.exists(&parent) {
        let _ = fs.mkdir_all(&parent);
        let _ = fs.chmod(&parent, 0o777);
    }
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
    opts: &PatchOpts,
    fs: &dyn SafeBashFs,
) -> Result<String, String> {
    let strip = opts.strip;
    let reverse = opts.reverse;
    let dry_run = opts.dry_run;
    let cwd = &opts.work_cwd;
    let mut staged_writes: Option<Vec<(String, Option<Vec<u8>>)>> = if opts.atomic {
        Some(Vec::new())
    } else {
        None
    };

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
                opts,
                fs,
                &mut staged_writes,
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
    let mut any_hunk_failed = false;
    let mut failed_rej_lines: Vec<String> = Vec::new();

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
                    opts,
                    fs,
                    &mut staged_writes,
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
            let hunk_header = line.to_string();
            let (old_start, new_start) = parse_hunk_starts(line);
            let orig_start = if reverse { new_start } else { old_start };
            idx += 1;
            let mut hunk_old = Vec::new();
            let mut hunk_new = Vec::new();
            let mut raw_hunk_lines = vec![hunk_header];
            let mut last_sign = ' ';
            let mut old_no_nl = false;
            let mut new_no_nl = false;
            while idx < lines.len() {
                let hl = lines[idx];
                if hl.starts_with("@@ ") || hl.starts_with("--- ") || hl.starts_with("+++ ") {
                    break;
                }
                raw_hunk_lines.push(hl.to_string());
                if hl.starts_with("\\ No newline at end of file") {
                    match last_sign {
                        '-' => old_no_nl = true,
                        '+' => new_no_nl = true,
                        _ => {
                            old_no_nl = true;
                            new_no_nl = true;
                        }
                    }
                    idx += 1;
                    continue;
                }
                if let Some(rem) = hl.strip_prefix('-') {
                    hunk_old.push(rem.to_string());
                    last_sign = '-';
                } else if let Some(add) = hl.strip_prefix('+') {
                    hunk_new.push(add.to_string());
                    last_sign = '+';
                } else if let Some(ctx) = hl.strip_prefix(' ') {
                    hunk_old.push(ctx.to_string());
                    hunk_new.push(ctx.to_string());
                    last_sign = ' ';
                } else if hl.is_empty() {
                    hunk_old.push(String::new());
                    hunk_new.push(String::new());
                    last_sign = ' ';
                }
                idx += 1;
            }
            if old_no_nl || new_no_nl {
                no_trailing_newline = if reverse { old_no_nl } else { new_no_nl };
            }

            if reverse {
                std::mem::swap(&mut hunk_old, &mut hunk_new);
            }
            let expected_pos = ((orig_start.saturating_sub(1) as isize) + offset).max(0) as usize;
            let pos_opt = find_subslice_pos(&file_lines, &hunk_old, expected_pos)
                .or_else(|| {
                    if opts.ignore_ws || opts.fuzz > 0 {
                        find_subslice_pos_fuzzy(&file_lines, &hunk_old, expected_pos, opts.ignore_ws, opts.fuzz)
                    } else {
                        None
                    }
                });
            let pos = match pos_opt {
                Some(p) => p,
                None => {
                    any_hunk_failed = true;
                    if opts.merge_mode {
                        let ins_at = expected_pos.min(file_lines.len());
                        let end_at = (ins_at + hunk_old.len()).min(file_lines.len());
                        let mut conflict_block = Vec::new();
                        let mut ci = 0usize;
                        while ci < hunk_old.len().max(hunk_new.len()) {
                            let ol = hunk_old.get(ci).map(|s| s.as_str()).unwrap_or("");
                            let nl = hunk_new.get(ci).map(|s| s.as_str()).unwrap_or("");
                            let fl = file_lines.get(ins_at + ci).map(|s| s.as_str()).unwrap_or("");
                            if ol == nl && fl == ol {
                                conflict_block.push(fl.to_string());
                            } else {
                                conflict_block.push("<<<<<<<".to_string());
                                if !fl.is_empty() {
                                    conflict_block.push(fl.to_string());
                                }
                                if opts.merge_diff3 {
                                    conflict_block.push("|||||||".to_string());
                                    if !ol.is_empty() {
                                        conflict_block.push(ol.to_string());
                                    }
                                }
                                conflict_block.push("=======".to_string());
                                if !nl.is_empty() {
                                    conflict_block.push(nl.to_string());
                                }
                                conflict_block.push(">>>>>>>".to_string());
                            }
                            ci += 1;
                        }
                        file_lines.splice(ins_at..end_at, conflict_block);
                    } else {
                        failed_rej_lines.extend(raw_hunk_lines);
                    }
                    continue;
                }
            };
            let old_len = hunk_old.len();
            let replacement: Vec<String> = if let Some(ref macro_name) = opts.ifdef_guard {
                let mut blk = vec![format!("#ifndef {macro_name}")];
                blk.extend(hunk_old.iter().cloned());
                blk.push("#else".to_string());
                blk.extend(hunk_new.iter().cloned());
                blk.push("#endif".to_string());
                blk
            } else {
                hunk_new
            };
            let new_len = replacement.len();
            file_lines.splice(pos..pos + old_len, replacement);
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
            opts,
            fs,
            &mut staged_writes,
        )?;
        if any_hunk_failed {
            if !opts.merge_mode && !opts.forward_only {
                let rej_target = if let Some(r) = reject_file {
                    Some(r.to_string())
                } else {
                    Some(format!("{target}.rej"))
                };
                if let Some(rt) = rej_target
                    && !dry_run
                {
                    let rej_full = resolve_posix_path(cwd, &rt);
                    let rej_body = format!("{}\n", failed_rej_lines.join("\n"));
                    let _ = fs.write_file(&rej_full, rej_body.as_bytes());
                }
            }
            return Err("hunk failed to apply".to_string());
        }
        if let Some(staged) = staged_writes {
            for (full, data_opt) in staged {
                if let Some(bytes) = data_opt {
                    let parent = crate::vfs::dirname_posix_path(&full);
                    if !parent.is_empty() && parent != "/" && !fs.exists(&parent) {
                        let _ = fs.mkdir_all(&parent);
                    }
                    fs.write_file(&full, &bytes)?;
                } else {
                    let _ = fs.remove(&full, false);
                }
            }
        }
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

fn find_subslice_pos_fuzzy(
    hay: &[String],
    needle: &[String],
    hint: usize,
    ignore_ws: bool,
    fuzz: usize,
) -> Option<usize> {
    let norm = |s: &str| -> String {
        if ignore_ws {
            s.split_whitespace().collect::<Vec<_>>().join(" ")
        } else {
            s.to_string()
        }
    };
    let n_norm: Vec<String> = needle.iter().map(|s| norm(s)).collect();
    let h_norm: Vec<String> = hay.iter().map(|s| norm(s)).collect();
    if let Some(pos) = find_subslice_pos(&h_norm, &n_norm, hint) {
        return Some(pos);
    }
    for f in 1..=fuzz {
        if f * 2 < n_norm.len() {
            let trimmed = &n_norm[f..n_norm.len() - f];
            if let Some(inner_pos) = find_subslice_pos(&h_norm, trimmed, hint) {
                return Some(inner_pos.saturating_sub(f));
            }
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
    let reject_unsafe_target = |target: &str, full: &str| -> Option<BuiltinOutcome> {
        if target.split('/').any(|seg| seg == "..") {
            return Some(err_out(
                &format!("apply_patch: {target}: path traversal is not allowed\n"),
                2,
            ));
        }
        let mut cur = String::new();
        for seg in full.split('/').filter(|s| !s.is_empty()) {
            cur.push('/');
            cur.push_str(seg);
            if fs.readlink(&cur).is_ok() {
                return Some(err_out(
                    &format!("apply_patch: {target}: symlink target is not allowed\n"),
                    1,
                ));
            }
        }
        None
    };

    let lines: Vec<&str> = patch_input.lines().collect();
    let mut idx = 0usize;
    let mut staged_ops: Vec<StagedPatchOp> = Vec::new();
    let mut summary_lines: Vec<String> = Vec::new();
    let mut seen_targets: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

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
            if let Some(err) = reject_unsafe_target(target, &full) {
                return err;
            }
            if !seen_targets.insert(full.clone()) {
                return err_out(&format!("apply_patch: duplicate file target {target}\n"), 1);
            }
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
            if let Some(err) = reject_unsafe_target(target, &full) {
                return err;
            }
            if !seen_targets.insert(full.clone()) {
                return err_out(&format!("apply_patch: duplicate file target {target}\n"), 1);
            }
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
            if let Some(err) = reject_unsafe_target(target, &full) {
                return err;
            }
            if !seen_targets.insert(full.clone()) {
                return err_out(&format!("apply_patch: duplicate file target {target}\n"), 1);
            }
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
                if let Some(err) = reject_unsafe_target(&dest, &dest_full) {
                    return err;
                }
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
    let mut print_bytes = false;
    let mut ignore_initial: Option<(usize, usize)> = None;
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
        } else if a == "-b" || a == "--print-bytes" {
            print_bytes = true;
            i += 1;
        } else if (a == "-i" || a == "--ignore-initial") && i + 1 < args.len() {
            let v = &args[i + 1];
            if let Some((s1, s2)) = v.split_once(':') {
                ignore_initial = Some((s1.parse().unwrap_or(0), s2.parse().unwrap_or(0)));
            } else {
                let n = v.parse().unwrap_or(0);
                ignore_initial = Some((n, n));
            }
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--ignore-initial=").or_else(|| a.strip_prefix("-i")) && !rest.is_empty() {
            if let Some((s1, s2)) = rest.split_once(':') {
                ignore_initial = Some((s1.parse().unwrap_or(0), s2.parse().unwrap_or(0)));
            } else {
                let n = rest.parse().unwrap_or(0);
                ignore_initial = Some((n, n));
            }
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
    let (skip1, skip2) = ignore_initial.unwrap_or_else(|| {
        (
            files.get(2).and_then(|s| s.parse::<usize>().ok()).unwrap_or(0),
            files.get(3).and_then(|s| s.parse::<usize>().ok()).unwrap_or(0),
        )
    });
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
    if print_bytes && diff_pos < min_len {
        let c1 = b1[diff_pos];
        let c2 = b2[diff_pos];
        return BuiltinOutcome {
            stdout: format!(
                "{} {} differ: byte {}, line {} is {:o} {} {:o} {}\n",
                files[0],
                files[1],
                diff_pos + 1,
                line_num,
                c1,
                c1 as char,
                c2,
                c2 as char
            ),
            stderr: String::new(),
            exit_code: 1,
        };
    }
    BuiltinOutcome {
        stdout: format!(
            "{} {} differ: char {}, line {}\n",
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
    let mut only_three = false;
    let mut ed_trailer = false;
    let mut initial_tab = false;
    let mut labels: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-m" || a == "--merge" {
            merge_mode = true;
            i += 1;
        } else if matches!(a.as_str(), "-e" | "-E" | "-x" | "-3" | "--ed") {
            ed_mode = true;
            if a == "-3" {
                only_three = true;
            }
            i += 1;
        } else if a == "-i" {
            ed_trailer = true;
            i += 1;
        } else if a == "-T" || a == "--initial-tab" {
            initial_tab = true;
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
        let mut ranges: Vec<(usize, usize)> = Vec::new();
        let mut idx = 0usize;
        let should_include = |o: &str, b: &str, t: &str| -> bool {
            if only_three {
                t != b && o == b
            } else {
                o != b || t != b
            }
        };
        while idx < max_len {
            let o = ours.get(idx).map(|s| s.as_str()).unwrap_or("");
            let b = base.get(idx).map(|s| s.as_str()).unwrap_or("");
            let t = theirs.get(idx).map(|s| s.as_str()).unwrap_or("");
            if should_include(o, b, t) {
                let start = idx;
                let mut has_theirs_change = false;
                while idx < max_len {
                    let o2 = ours.get(idx).map(|s| s.as_str()).unwrap_or("");
                    let b2 = base.get(idx).map(|s| s.as_str()).unwrap_or("");
                    let t2 = theirs.get(idx).map(|s| s.as_str()).unwrap_or("");
                    if should_include(o2, b2, t2) {
                        if t2 != b2 {
                            has_theirs_change = true;
                        }
                        idx += 1;
                    } else {
                        break;
                    }
                }
                if has_theirs_change {
                    ranges.push((start, idx - 1));
                }
            } else {
                idx += 1;
            }
        }
        for (s, e) in ranges.into_iter().rev() {
            if s == e {
                out.push_str(&format!("{}c\n", s + 1));
            } else {
                out.push_str(&format!("{},{}c\n", s + 1, e + 1));
            }
            for k in s..=e {
                if let Some(t) = theirs.get(k) {
                    out.push_str(t);
                    out.push('\n');
                }
            }
            out.push_str(".\n");
        }
        if ed_trailer {
            out.push_str("w\nq\n");
        }
        return ok_out(&out);
    }
    if !merge_mode {
        let indent = if initial_tab { "\t" } else { "  " };
        for i in 0..max_len {
            let o = ours.get(i).map(|s| s.as_str()).unwrap_or("");
            let b = base.get(i).map(|s| s.as_str()).unwrap_or("");
            let t = theirs.get(i).map(|s| s.as_str()).unwrap_or("");
            if o != b || t != b {
                let tag = if o != b && b == t {
                    "====1"
                } else if o == t && o != b {
                    "====2"
                } else if t != b && o == b {
                    "====3"
                } else {
                    "===="
                };
                out.push_str(&format!(
                    "{tag}\n1:{}c\n{indent}{o}\n2:{}c\n{indent}{b}\n3:{}c\n{indent}{t}\n",
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

fn cmd_wdiff(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.len() == 1 && args[0] == "--help" {
        return ok_out("Usage: wdiff OLD NEW\nCompare whitespace-delimited words; [-deleted-] and {+inserted+}.\n");
    }
    let operands = if args.first().map(|s| s.as_str()) == Some("--") {
        &args[1..]
    } else {
        args
    };
    if operands.len() != 2 || operands.iter().filter(|s| s.as_str() == "-").count() > 1 {
        return err_out("wdiff: expected two files (at most one stdin operand)\n", 2);
    }
    #[derive(Clone)]
    struct WWord {
        space: String,
        text: String,
    }
    let tokenize = |bytes: &[u8]| -> (Vec<WWord>, String) {
        let is_space = |b: u8| b == 32 || (9..=13).contains(&b);
        let mut res = Vec::new();
        let mut off = 0usize;
        while off < bytes.len() {
            let start = off;
            while off < bytes.len() && is_space(bytes[off]) {
                off += 1;
            }
            let space = crate::vfs::bytes_to_stream_string(&bytes[start..off]);
            let first = off;
            while off < bytes.len() && !is_space(bytes[off]) {
                off += 1;
            }
            if first == off {
                return (res, space);
            }
            let text = crate::vfs::bytes_to_stream_string(&bytes[first..off]);
            res.push(WWord { space, text });
        }
        (res, String::new())
    };
    let mut inputs = Vec::new();
    for name in operands {
        let bytes = if name == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let full = resolve_posix_path(cwd, name);
            match fs.read_file(&full) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("wdiff: {name}: {e}\n"), 2),
            }
        };
        inputs.push(tokenize(&bytes));
    }
    let (a, _) = &inputs[0];
    let (b, trailing) = &inputs[1];
    let width = b.len() + 1;
    let mut matrix = vec![0u32; (a.len() + 1) * width];
    for i in (0..a.len()).rev() {
        for j in (0..b.len()).rev() {
            matrix[i * width + j] = if a[i].text == b[j].text {
                1 + matrix[(i + 1) * width + j + 1]
            } else {
                matrix[(i + 1) * width + j].max(matrix[i * width + j + 1])
            };
        }
    }
    let mut out = String::new();
    let mut i = 0usize;
    let mut j = 0usize;
    let mut changed = false;
    while i < a.len() || j < b.len() {
        if i < a.len() && j < b.len() && a[i].text == b[j].text {
            out.push_str(&b[j].space);
            out.push_str(&b[j].text);
            i += 1;
            j += 1;
            continue;
        }
        changed = true;
        let mut removed: Vec<&WWord> = Vec::new();
        let mut added: Vec<&WWord> = Vec::new();
        while (i < a.len() || j < b.len()) && !(i < a.len() && j < b.len() && a[i].text == b[j].text) {
            if i < a.len() && (j == b.len() || matrix[(i + 1) * width + j] >= matrix[i * width + j + 1]) {
                removed.push(&a[i]);
                i += 1;
            } else {
                added.push(&b[j]);
                j += 1;
            }
        }
        if !removed.is_empty() {
            out.push_str(&removed[0].space);
            out.push_str("[-");
            for (idx, w) in removed.iter().enumerate() {
                if idx > 0 {
                    out.push_str(&w.space);
                }
                out.push_str(&w.text);
            }
            out.push_str("-]");
        }
        if !added.is_empty() {
            if !removed.is_empty() {
                out.push(' ');
            } else {
                out.push_str(&added[0].space);
            }
            out.push_str("{+");
            for (idx, w) in added.iter().enumerate() {
                if idx > 0 {
                    out.push_str(&w.space);
                }
                out.push_str(&w.text);
            }
            out.push_str("+}");
        }
    }
    out.push_str(trailing);
    BuiltinOutcome {
        stdout: out,
        stderr: String::new(),
        exit_code: if changed { 1 } else { 0 },
    }
}
