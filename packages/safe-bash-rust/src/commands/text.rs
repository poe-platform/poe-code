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
        "diff3" => Some(cmd_diff3(args, stdin, cwd, fs)),
        "patch" => Some(cmd_patch(args, stdin, cwd, fs)),
        "apply_patch" | "apply-patch" => Some(cmd_apply_patch(args, stdin, cwd, fs)),
        "cmp" => Some(cmd_cmp(args, stdin, cwd, env, fs)),
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
    Regex(String, bool),
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
    let mut line_length = 70usize;
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
            if a == "-h" || a == "--help" {
                return ok_out("Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n");
            } else if a == "-n" || a == "--quiet" || a == "--silent" {
                quiet = true;
            } else if a == "-u" || a == "--unbuffered" {
            } else if a == "-E" || a == "-r" || a == "--regexp-extended" {
                extended = true;
            } else if a == "-s" || a == "--separate" {
                separate = true;
            } else if a == "-z" || a == "--null-data" {
                null_data = true;
            } else if a == "--in-place" {
                in_place = true;
            } else if let Some(suf) = a.strip_prefix("-i") {
                in_place = true;
                in_place_suffix = suf.to_string();
                if in_place_suffix.is_empty() && i + 1 < args.len() && args[i + 1].is_empty() {
                    i += 1;
                }
            } else if let Some(suf) = a.strip_prefix("--in-place=") {
                in_place = true;
                in_place_suffix = suf.to_string();
            } else if a == "-l" || a == "--line-length" {
                if i + 1 >= args.len() {
                    return err_out("sed: option requires an argument -- 'l'\n", 2);
                }
                i += 1;
                match args[i].parse::<usize>() {
                    Ok(v) => line_length = v,
                    Err(_) => return err_out("sed: invalid line length\n", 2),
                }
            } else if let Some(rest) = a.strip_prefix("-l").or_else(|| a.strip_prefix("--line-length=")) {
                match rest.parse::<usize>() {
                    Ok(v) => line_length = v,
                    Err(_) => return err_out("sed: invalid line length\n", 2),
                }
            } else if a == "-e" || a == "--expression" {
                if i + 1 < args.len() {
                    i += 1;
                    scripts.push(args[i].clone());
                } else {
                    return err_out("sed: -e requires an argument\n", 2);
                }
            } else if let Some(rest) = a.strip_prefix("-e").or_else(|| a.strip_prefix("--expression=")) {
                scripts.push(rest.to_string());
            } else if a == "-f" || a == "--file" {
                if i + 1 < args.len() {
                    i += 1;
                    let p = resolve_posix_path(cwd, &args[i]);
                    if let Ok(b) = fs.read_file(&p) {
                        scripts.push(String::from_utf8_lossy(&b).into_owned());
                    } else {
                        return err_out(&format!("sed: couldn't open file {}: No such file or directory\n", args[i]), 2);
                    }
                } else {
                    return err_out("sed: -f requires an argument\n", 2);
                }
            } else if let Some(rest) = a.strip_prefix("-f").or_else(|| a.strip_prefix("--file=")) {
                let p = resolve_posix_path(cwd, rest);
                if let Ok(b) = fs.read_file(&p) {
                    scripts.push(String::from_utf8_lossy(&b).into_owned());
                } else {
                    return err_out(&format!("sed: couldn't open file {rest}: No such file or directory\n"), 2);
                }
            } else if a.starts_with("--") {
                return err_out(&format!("sed: unsupported option '{a}'\n"), 2);
            } else {
                let chars: Vec<char> = a[1..].chars().collect();
                let mut p = 0usize;
                while p < chars.len() {
                    let ch = chars[p];
                    match ch {
                        'n' => quiet = true,
                        'u' => {}
                        'i' => {
                            in_place = true;
                            in_place_suffix = chars[p + 1..].iter().collect();
                            break;
                        }
                        'E' | 'r' => extended = true,
                        's' => separate = true,
                        'z' => null_data = true,
                        'e' => {
                            let rest: String = chars[p + 1..].iter().collect();
                            if !rest.is_empty() {
                                scripts.push(rest);
                            } else if i + 1 < args.len() {
                                i += 1;
                                scripts.push(args[i].clone());
                            } else {
                                return err_out("sed: -e requires an argument\n", 2);
                            }
                            break;
                        }
                        'f' => {
                            let rest: String = chars[p + 1..].iter().collect();
                            let fname = if !rest.is_empty() {
                                rest
                            } else if i + 1 < args.len() {
                                i += 1;
                                args[i].clone()
                            } else {
                                return err_out("sed: -f requires an argument\n", 2);
                            };
                            let path = resolve_posix_path(cwd, &fname);
                            if let Ok(b) = fs.read_file(&path) {
                                scripts.push(String::from_utf8_lossy(&b).into_owned());
                            } else {
                                return err_out(&format!("sed: couldn't open file {fname}: No such file or directory\n"), 2);
                            }
                            break;
                        }
                        'l' => {
                            let rest: String = chars[p + 1..].iter().collect();
                            let val_str = if !rest.is_empty() {
                                rest
                            } else if i + 1 < args.len() {
                                i += 1;
                                args[i].clone()
                            } else {
                                return err_out("sed: -l requires an argument\n", 2);
                            };
                            match val_str.parse::<usize>() {
                                Ok(v) => line_length = v,
                                Err(_) => return err_out("sed: invalid line length\n", 2),
                            }
                            break;
                        }
                        _ => return err_out(&format!("sed: unsupported option '-{ch}'\n"), 2),
                    }
                    p += 1;
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

    if scripts.is_empty() {
        return err_out("sed: missing program\n", 2);
    }
    if scripts.first().is_some_and(|s| s.starts_with("#n")) {
        quiet = true;
    }
    if in_place {
        if files.is_empty() || files.iter().any(|f| f == "-") {
            return err_out("sed: in-place editing requires named files\n", 2);
        }
        if in_place_suffix.contains('/') || in_place_suffix.contains('\0') {
            return err_out("sed: backup suffix cannot contain '/' or NUL\n", 2);
        }
    }

    let combined_script = scripts.join("\n");
    let stmts = match split_sed_statements(&combined_script) {
        Ok(v) => v,
        Err(msg) => return err_out(&msg, 2),
    };
    let mut parsed_cmds = Vec::new();
    for part in stmts {
        match parse_sed_cmd(&part, extended, cwd, fs) {
            Ok(Some(c)) => parsed_cmds.push(c),
            Ok(None) => {}
            Err(msg) => return err_out(&msg, 2),
        }
    }
    if let Err(msg) = validate_sed_labels(&parsed_cmds) {
        return err_out(&msg, 2);
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
                let (res, code, err_msg) = run_sed_on_text(&content, f, &mut cmds_copy, quiet, null_data, line_length, &mut write_files);
                if let Some(em) = err_msg {
                    return err_out(&em, code);
                }
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
            let (part_out, code, err_msg) = run_sed_on_text(&content, f, &mut cmds_copy, quiet, null_data, line_length, &mut write_files);
            if let Some(em) = err_msg {
                return err_out(&em, code);
            }
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
    let (out, exit_code, err_msg) = run_sed_on_text(&combined_in, cur_fname, &mut parsed_cmds, quiet, null_data, line_length, &mut write_files);
    if let Some(em) = err_msg {
        return err_out(&em, exit_code);
    }
    for (wf, data) in write_files {
        let _ = fs.write_file(&resolve_posix_path(cwd, &wf), data.as_bytes());
    }
    BuiltinOutcome {
        stdout: out,
        stderr: String::new(),
        exit_code,
    }
}

fn split_sed_statements(script: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = script.chars().collect();
    let mut idx = 0usize;
    let mut in_slash: Option<char> = None;
    let mut slash_count = 0usize;
    let mut in_addr_regex: Option<char> = None;
    let mut in_text_cmd = false;
    let mut brace_depth = 0i32;

    while idx < chars.len() {
        let c = chars[idx];
        if c == '#' && in_addr_regex.is_none() && in_slash.is_none() && !in_text_cmd && cur.trim().is_empty() {
            while idx < chars.len() && chars[idx] != '\n' {
                idx += 1;
            }
            continue;
        }
        if c == '\\'
            && idx + 1 < chars.len()
            && in_addr_regex.is_none()
            && in_slash.is_none()
            && !in_text_cmd
            && chars[idx + 1] != '\n'
            && {
                let ct = cur.trim();
                ct.is_empty() || ct.ends_with(',') || ct.ends_with('{')
            }
        {
            let delim = chars[idx + 1];
            in_addr_regex = Some(delim);
            cur.push('\\');
            cur.push(delim);
            idx += 2;
            continue;
        }
        if c == '\\' && idx + 1 < chars.len() {
            cur.push(c);
            cur.push(chars[idx + 1]);
            idx += 2;
            continue;
        }
        if c == '\n' {
            in_slash = None;
            in_addr_regex = None;
            in_text_cmd = false;
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
        if in_text_cmd {
            cur.push(c);
            idx += 1;
            continue;
        }
        if let Some(delim) = in_addr_regex {
            cur.push(c);
            if c == delim {
                in_addr_regex = None;
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
            in_addr_regex = Some('/');
            cur.push(c);
            idx += 1;
            continue;
        }
        if matches!(c, 'a' | 'i' | 'c')
            && (idx + 1 >= chars.len() || chars[idx + 1] == '\\' || chars[idx + 1].is_whitespace())
        {
            let (_, _, _, rem, _) = parse_sed_addresses(&cur, false);
            if rem.trim().is_empty() {
                in_text_cmd = true;
                cur.push(c);
                idx += 1;
                continue;
            }
        }
        if (c == 's' || c == 'y')
            && idx + 1 < chars.len()
            && !chars[idx + 1].is_ascii_alphanumeric()
            && !chars[idx + 1].is_whitespace()
            && {
                let (_, _, _, rem, err) = parse_sed_addresses(&cur, false);
                err.is_none() && rem.trim().is_empty()
            }
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
            if brace_depth == 0 {
                return Err("sed: unmatched '}'\n".to_string());
            }
            brace_depth -= 1;
            if brace_depth == 0 {
                let (_, _, _, after_addr, _) = parse_sed_addresses(&cur, false);
                if !after_addr.trim_start().starts_with('{') {
                    return Err("sed: unmatched '}'\n".to_string());
                }
                cur.push('}');
                let t = cur.trim().to_string();
                if !t.is_empty() {
                    out.push(t);
                }
                cur.clear();
                idx += 1;
                continue;
            }
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
    if brace_depth != 0 {
        return Err("sed: unclosed sed group\n".to_string());
    }
    let t = cur.trim().to_string();
    if !t.is_empty() {
        out.push(t);
    }
    Ok(out)
}

fn count_sed_regex_groups(pat: &str, extended: bool) -> usize {
    let chs: Vec<char> = pat.chars().collect();
    let mut k = 0usize;
    let mut in_bracket = false;
    let mut groups = 0usize;
    while k < chs.len() {
        if chs[k] == '\\' && k + 1 < chs.len() {
            if !in_bracket && !extended && chs[k + 1] == '(' {
                groups += 1;
            }
            k += 2;
        } else if chs[k] == '[' && !in_bracket {
            in_bracket = true;
            k += 1;
            if k < chs.len() && (chs[k] == '^' || chs[k] == '!') {
                k += 1;
            }
            if k < chs.len() && chs[k] == ']' {
                k += 1;
            }
        } else if chs[k] == ']' && in_bracket {
            in_bracket = false;
            k += 1;
        } else {
            if !in_bracket && extended && chs[k] == '(' {
                groups += 1;
            }
            k += 1;
        }
    }
    groups
}

fn max_sed_repl_backref(repl: &str) -> usize {
    let chs: Vec<char> = repl.chars().collect();
    let mut k = 0usize;
    let mut max_ref = 0usize;
    while k < chs.len() {
        if chs[k] == '\\' && k + 1 < chs.len() {
            let nc = chs[k + 1];
            if nc.is_ascii_digit() && nc != '0' {
                max_ref = max_ref.max((nc as u8 - b'0') as usize);
            }
            k += 2;
        } else {
            k += 1;
        }
    }
    max_ref
}

fn collect_sed_labels(cmds: &[SedCmd], labels: &mut std::collections::BTreeSet<String>) -> Result<(), String> {
    for c in cmds {
        match &c.op {
            SedOp::Label(l) => {
                if l.is_empty() || !labels.insert(l.clone()) {
                    return Err("sed: empty or duplicate branch label\n".to_string());
                }
            }
            SedOp::Group(inner) => collect_sed_labels(inner, labels)?,
            _ => {}
        }
    }
    Ok(())
}

fn check_sed_branches(cmds: &[SedCmd], labels: &std::collections::BTreeSet<String>) -> Result<(), String> {
    for c in cmds {
        match &c.op {
            SedOp::Branch(Some(l)) | SedOp::BranchIfSubst(Some(l)) | SedOp::BranchIfNotSubst(Some(l)) => {
                if !labels.contains(l) {
                    return Err(format!("sed: undefined branch label '{l}'\n"));
                }
            }
            SedOp::Group(inner) => check_sed_branches(inner, labels)?,
            _ => {}
        }
    }
    Ok(())
}

fn validate_sed_labels(cmds: &[SedCmd]) -> Result<(), String> {
    let mut labels = std::collections::BTreeSet::new();
    collect_sed_labels(cmds, &mut labels)?;
    check_sed_branches(cmds, &labels)
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

fn parse_sed_cmd(stmt: &str, extended: bool, cwd: &str, fs: &dyn SafeBashFs) -> Result<Option<SedCmd>, String> {
    let s = stmt.trim();
    if s.is_empty() || s.starts_with('#') {
        return Ok(None);
    }
    if let Some(lbl) = s.strip_prefix(':') {
        let label_name = lbl.trim().to_string();
        if label_name.is_empty() {
            return Err("sed: empty branch label\n".to_string());
        }
        return Ok(Some(SedCmd {
            addr1: None,
            addr2: None,
            negated: false,
            op: SedOp::Label(label_name),
            in_range: false,
            range_start_line: 0,
        }));
    }
    let (addr1, addr2, negated, rest, addr_err) = parse_sed_addresses(s, extended);
    if let Some(ae) = addr_err {
        return Err(ae);
    }
    let rest = rest.trim();
    if rest.is_empty() {
        if addr1.is_some() || negated {
            return Err("sed: missing sed command\n".to_string());
        }
        return Ok(None);
    }
    let first = rest.chars().next().unwrap();
    let op = match first {
        'd' => {
            if !rest[1..].trim().is_empty() && !rest[1..].trim().starts_with('#') {
                return Err("sed: unexpected text after 'd' command\n".to_string());
            }
            SedOp::Delete
        }
        'D' => SedOp::DeleteFirstLine,
        'p' => SedOp::Print,
        'P' => SedOp::PrintFirstLine,
        'q' | 'Q' => {
            if addr2.is_some() {
                return Err("sed: quit accepts at most one address\n".to_string());
            }
            let code_str = rest[1..].trim();
            let code = if code_str.is_empty() {
                None
            } else {
                match code_str.parse::<i32>() {
                    Ok(v) if (0..=255).contains(&v) => Some(v),
                    _ => return Err("sed: invalid quit status\n".to_string()),
                }
            };
            if first == 'q' { SedOp::Quit(code) } else { SedOp::QuitSilent(code) }
        }
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
        ':' => {
            if addr1.is_some() || negated {
                return Err("sed: labels cannot have addresses\n".to_string());
            }
            let lbl = rest[1..].trim().to_string();
            if lbl.is_empty() {
                return Err("sed: empty branch label\n".to_string());
            }
            SedOp::Label(lbl)
        }
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
            if wf.is_empty() {
                return Err("sed: w command requires a filename\n".to_string());
            }
            SedOp::WriteFile(wf)
        }
        'r' => {
            if addr2.is_some() {
                return Err("sed: read accepts at most one address\n".to_string());
            }
            let rf = rest[1..].trim();
            if rf.is_empty() {
                return Err("sed: r command requires a filename\n".to_string());
            }
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
            let Some(inner) = rest
                .strip_prefix('{')
                .and_then(|r| r.trim_end().strip_suffix('}'))
            else {
                return Err("sed: unclosed sed group\n".to_string());
            };
            let mut sub_cmds = Vec::new();
            for part in split_sed_statements(inner)? {
                if let Some(c) = parse_sed_cmd(&part, extended, cwd, fs)? {
                    sub_cmds.push(c);
                }
            }
            SedOp::Group(sub_cmds)
        }
        '}' => {
            return Err("sed: unmatched '}'\n".to_string());
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
                return Err("sed: invalid y command\n".to_string());
            }
            let delim = chars[1];
            let delim_len = delim.len_utf8();
            let Some(parts) = split_sed_delim(&rest[1 + delim_len..], delim) else {
                return Err("sed: unterminated y command\n".to_string());
            };
            if parts.len() < 3 || !parts[2].trim().is_empty() {
                return Err("sed: invalid y command\n".to_string());
            }
            let src_chars: Vec<char> = unescape_sed_text(&parts[0]).chars().collect();
            let dst_chars: Vec<char> = unescape_sed_text(&parts[1]).chars().collect();
            if src_chars.len() != dst_chars.len() {
                return Err("sed: translation sets have different lengths\n".to_string());
            }
            SedOp::Transliterate(src_chars, dst_chars)
        }
        's' => {
            let chars: Vec<char> = rest.chars().collect();
            if chars.len() < 4 {
                return Err("sed: invalid s command\n".to_string());
            }
            let delim = chars[1];
            if delim == '\\' || delim == '\n' {
                return Err("sed: invalid substitution delimiter\n".to_string());
            }
            let delim_len = delim.len_utf8();
            let Some(parts) = split_sed_delim(&rest[1 + delim_len..], delim) else {
                return Err("sed: unterminated substitution\n".to_string());
            };
            if parts.len() < 3 {
                return Err("sed: unterminated substitution\n".to_string());
            }
            if !parts[0].is_empty() && max_sed_repl_backref(&parts[1]) > count_sed_regex_groups(&parts[0], extended) {
                return Err("sed: replacement references an undefined capture group\n".to_string());
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
            let flag_chars: Vec<(usize, char)> = flags.char_indices().collect();
            let mut fi = 0usize;
            while fi < flag_chars.len() {
                let (f_idx, ch) = flag_chars[fi];
                match ch {
                    ' ' | '\t' => break,
                    '#' => break,
                    'g' => global = true,
                    'i' | 'I' => ignore_case = true,
                    'p' => print_flag = true,
                    '1'..='9' => {
                        if nth.is_some() {
                            return Err("sed: multiple number options to 's' command\n".to_string());
                        }
                        let mut num_str = String::from(ch);
                        while fi + 1 < flag_chars.len() && flag_chars[fi + 1].1.is_ascii_digit() {
                            fi += 1;
                            num_str.push(flag_chars[fi].1);
                        }
                        match num_str.parse::<usize>() {
                            Ok(v) if v > 0 => nth = Some(v),
                            _ => return Err("sed: invalid substitution occurrence\n".to_string()),
                        }
                    }
                    'w' => {
                        let wf = flags[f_idx + 1..].trim();
                        if !wf.is_empty() {
                            write_file = Some(wf.to_string());
                        } else {
                            return Err("sed: w flag requires a filename\n".to_string());
                        }
                        break;
                    }
                    other => return Err(format!("sed: unsupported substitution flag '{other}'\n")),
                }
                fi += 1;
            }
            if pat.is_empty() && ignore_case {
                return Err("sed: flags on an empty regex are not supported\n".to_string());
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
        other => return Err(format!("sed: unsupported sed command '{other}'\n")),
    };

    Ok(Some(SedCmd {
        addr1,
        addr2,
        negated,
        op,
        in_range: false,
        range_start_line: 0,
    }))
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

fn parse_sed_addresses(s: &str, extended: bool) -> (Option<SedAddr>, Option<SedAddr>, bool, &str, Option<String>) {
    let (a1, rest1, err1) = parse_one_sed_addr(s.trim_start(), extended);
    if let Some(e) = err1 {
        return (None, None, false, s, Some(e));
    }
    let mut rest = rest1.trim_start();
    let mut a2 = None;
    if a1.is_some() && rest.starts_with(',') {
        let (parsed_a2, rest2, err2) = parse_one_sed_addr(rest[1..].trim_start(), extended);
        if let Some(e) = err2 {
            return (None, None, false, s, Some(e));
        }
        if parsed_a2.is_none() {
            return (None, None, false, s, Some("sed: invalid address range\n".to_string()));
        }
        a2 = parsed_a2;
        rest = rest2.trim_start();
    }
    if matches!(a1, Some(SedAddr::Line(0))) && !matches!(a2, Some(SedAddr::Regex(_, _))) {
        return (None, None, false, s, Some("sed: zero address requires a 0,/regex/ range\n".to_string()));
    }
    if matches!(a2, Some(SedAddr::Line(0))) {
        return (None, None, false, s, Some("sed: zero address requires a 0,/regex/ range\n".to_string()));
    }
    let negated = if rest.starts_with('!') {
        rest = rest[1..].trim_start();
        true
    } else {
        false
    };
    (a1, a2, negated, rest, None)
}

fn parse_one_sed_addr(s: &str, extended: bool) -> (Option<SedAddr>, &str, Option<String>) {
    if let Some(rest) = s.strip_prefix('$') {
        return (Some(SedAddr::Last), rest, None);
    }
    if let Some(rest) = s.strip_prefix('+') {
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<usize>() {
            return (Some(SedAddr::RelPlus(n)), &rest[digits.len()..], None);
        }
    }
    if let Some(rest) = s.strip_prefix('~') {
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<usize>() {
            return (Some(SedAddr::RelStep(n)), &rest[digits.len()..], None);
        }
    }
    let delim_and_rest = if let Some(rest) = s.strip_prefix('/') {
        Some(('/', rest))
    } else if let Some(after_bs) = s.strip_prefix('\\') {
        let mut chs = after_bs.chars();
        if let Some(d) = chs.next()
            && d != '\n'
        {
            Some((d, &after_bs[d.len_utf8()..]))
        } else {
            None
        }
    } else {
        None
    };
    if let Some((delim, rest)) = delim_and_rest {
        let mut pat = String::new();
        let mut idx = 0usize;
        let chars: Vec<char> = rest.chars().collect();
        while idx < chars.len() {
            if chars[idx] == '\\' && idx + 1 < chars.len() {
                if chars[idx + 1] == delim {
                    pat.push(delim);
                } else {
                    pat.push(chars[idx]);
                    pat.push(chars[idx + 1]);
                }
                idx += 2;
                continue;
            }
            if chars[idx] == delim {
                let byte_offset: usize = chars[..=idx].iter().map(|c| c.len_utf8()).sum();
                let after_delim = &rest[byte_offset..];
                let (ic, final_rest) = if let Some(r) = after_delim.strip_prefix('I') {
                    (true, r)
                } else {
                    (false, after_delim)
                };
                if pat.is_empty() && ic {
                    return (None, s, Some("sed: flags on an empty regex are not supported\n".to_string()));
                }
                let conv = if pat.is_empty() {
                    String::new()
                } else if extended {
                    convert_ere_escaped_parens(&pat)
                } else {
                    convert_bre_parens(&pat)
                };
                return (Some(SedAddr::Regex(conv, ic)), final_rest, None);
            }
            pat.push(chars[idx]);
            idx += 1;
        }
        return (None, s, Some("sed: unterminated address regex\n".to_string()));
    }
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty()
        && let Ok(n) = digits.parse::<usize>()
    {
        let after_n = &s[digits.len()..];
        if let Some(after_tilde) = after_n.strip_prefix('~') {
            let step_digits: String = after_tilde.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(step) = step_digits.parse::<usize>() {
                return (Some(SedAddr::Step(n, step)), &after_tilde[step_digits.len()..], None);
            }
        }
        return (Some(SedAddr::Line(n)), after_n, None);
    }
    (None, s, None)
}

fn addr_matches(
    addr: &SedAddr,
    line_num: usize,
    is_last: bool,
    line: &str,
    last_regex: &mut Option<(String, bool)>,
) -> Result<bool, String> {
    match addr {
        SedAddr::Line(n) => Ok(line_num == *n),
        SedAddr::Step(first, step) => {
            let matched = if *step == 0 {
                line_num == *first
            } else if *first == 0 {
                line_num.is_multiple_of(*step)
            } else {
                line_num >= *first && (line_num - *first).is_multiple_of(*step)
            };
            Ok(matched)
        }
        SedAddr::RelPlus(_) | SedAddr::RelStep(_) => Ok(false),
        SedAddr::Last => Ok(is_last),
        SedAddr::Regex(pat, ic) => {
            let (eff_pat, eff_ic) = if pat.is_empty() {
                match last_regex.clone() {
                    Some(prev) => prev,
                    None => return Err("sed: no previous regular expression\n".to_string()),
                }
            } else {
                let pair = (pat.clone(), *ic);
                *last_regex = Some(pair.clone());
                pair
            };
            if (pat == "^\\(.*\\)\\n\\1$" || pat == "^(.*)\\n\\1$")
                && let Some((a, b)) = line.split_once('\n')
            {
                return Ok(a == b);
            }
            let unescaped = eff_pat.replace("\\n", "\n");
            Ok(ZeroRegex::new(vec![unescaped], eff_ic, false, false, false).is_match(line))
        }
    }
}

enum SedFlow {
    Continue,
    Delete,
    RestartCycle,
    Quit(Option<i32>, bool),
    Branch(Option<String>),
    Error(String),
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
    line_length: usize,
    last_regex: &mut Option<(String, bool)>,
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
            (Some(a1), None) => match addr_matches(a1, line_num, is_last, pattern_space, last_regex) {
                Ok(b) => b,
                Err(e) => return SedFlow::Error(e),
            },
            (Some(a1), Some(a2)) => {
                if !cmd.in_range {
                    let start_matched = match a1 {
                        SedAddr::Line(0) => line_num == 1 && cmd.range_start_line == 0,
                        other => match addr_matches(other, line_num, is_last, pattern_space, last_regex) {
                            Ok(b) => b,
                            Err(e) => return SedFlow::Error(e),
                        },
                    };
                    if start_matched {
                        let end_same = match a2 {
                            SedAddr::Line(n) => *n <= line_num,
                            SedAddr::RelPlus(0) | SedAddr::RelStep(0) => true,
                            other => {
                                if matches!(a1, SedAddr::Line(0)) {
                                    match addr_matches(other, line_num, is_last, pattern_space, last_regex) {
                                        Ok(b) => b,
                                        Err(e) => return SedFlow::Error(e),
                                    }
                                } else {
                                    false
                                }
                            }
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
                        SedAddr::RelStep(step) => *step == 0 || (line_num > cmd.range_start_line && line_num.is_multiple_of(*step)),
                        other => match addr_matches(other, line_num, is_last, pattern_space, last_regex) {
                            Ok(b) => b,
                            Err(e) => return SedFlow::Error(e),
                        },
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
                if let Some(nl_pos) = pattern_space.find(rec_term) {
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
                let first_line = pattern_space.split(rec_term).next().unwrap_or(pattern_space);
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
                out.push(rec_term);
            }
            SedOp::List => {
                let chars: Vec<char> = pattern_space.chars().collect();
                let mut line = String::new();
                for offset in 0..=chars.len() {
                    let ch_opt = chars.get(offset).copied();
                    let line_end = ch_opt == Some('\n') && rec_term == '\n';
                    let token = match ch_opt {
                        None => "$".to_string(),
                        Some(_) if line_end => "$".to_string(),
                        Some('\x07') => "\\a".to_string(),
                        Some('\x08') => "\\b".to_string(),
                        Some('\x0c') => "\\f".to_string(),
                        Some('\n') => "\\n".to_string(),
                        Some('\r') => "\\r".to_string(),
                        Some('\t') => "\\t".to_string(),
                        Some('\x0b') => "\\v".to_string(),
                        Some('\\') => "\\\\".to_string(),
                        Some(c) if (c as u32) < 32 || (c as u32) >= 127 => {
                            format!("\\{:03o}", (c as u32) & 0xff)
                        }
                        Some(c) => c.to_string(),
                    };
                    if line_length > 0
                        && ch_opt.is_some()
                        && !line_end
                        && line.len() + token.len() >= line_length
                    {
                        out.push_str(&line);
                        out.push('\\');
                        out.push(rec_term);
                        line.clear();
                    }
                    line.push_str(&token);
                    if line_end {
                        out.push_str(&line);
                        out.push(rec_term);
                        line.clear();
                    }
                }
                out.push_str(&line);
                out.push(rec_term);
            }
            SedOp::LineNumber => {
                out.push_str(&line_num.to_string());
                out.push(rec_term);
            }
            SedOp::HoldCopy => {
                *hold_space = pattern_space.clone();
            }
            SedOp::HoldAppend => {
                hold_space.push(rec_term);
                hold_space.push_str(pattern_space);
            }
            SedOp::GetCopy => {
                *pattern_space = hold_space.clone();
            }
            SedOp::GetAppend => {
                pattern_space.push(rec_term);
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
                for ap in appends.drain(..) {
                    out.push_str(&ap);
                    out.push(rec_term);
                }
                if *line_idx + 1 < total {
                    *line_idx += 1;
                    pattern_space.push(rec_term);
                    pattern_space.push_str(raw_lines[*line_idx]);
                    *subst_made = false;
                } else {
                    return SedFlow::Quit(None, true);
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
                let did_not_subst = !*subst_made;
                *subst_made = false;
                if did_not_subst {
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
                    line_length,
                    last_regex,
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
                if cmd.addr2.is_none() || !still_in_range || cmd.negated || is_last {
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
                let (eff_pat, eff_ic) = if pat.is_empty() {
                    match last_regex.clone() {
                        Some(prev) => prev,
                        None => return SedFlow::Error("sed: no previous regular expression\n".to_string()),
                    }
                } else {
                    let pair = (pat.clone(), *ignore_case);
                    *last_regex = Some(pair.clone());
                    pair
                };
                let (new_text, did_replace) = replace_regex_in_text(
                    pattern_space,
                    &eff_pat,
                    repl,
                    eff_ic,
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
    line_length: usize,
    write_files: &mut BTreeMap<String, String>,
) -> (String, i32, Option<String>) {
    if input.is_empty() {
        return (String::new(), 0, None);
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
    let mut last_regex: Option<(String, bool)> = None;

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
                line_length,
                &mut last_regex,
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
                SedFlow::Error(msg) => {
                    return (String::new(), 2, Some(msg));
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

    (out, exit_code, None)
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
    numeric_vars: std::collections::BTreeSet<String>,
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
    ofmt: String,
    convfmt: String,
    output: String,
    next_requested: bool,
    nextfile_requested: bool,
    break_requested: bool,
    continue_requested: bool,
    return_val: Option<String>,
    exit_requested: bool,
    exit_status: i32,
    runtime_err: Option<String>,
    rng_state: u32,
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
        let ofmt = vars.get("OFMT").cloned().unwrap_or_else(|| "%.6g".to_string());
        let convfmt = vars.get("CONVFMT").cloned().unwrap_or_else(|| "%.6g".to_string());
        vars.entry("SUBSEP".to_string()).or_insert_with(|| "\x1c".to_string());
        Self {
            vars,
            numeric_vars: std::collections::BTreeSet::new(),
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
            ofmt,
            convfmt,
            output: String::new(),
            next_requested: false,
            nextfile_requested: false,
            break_requested: false,
            continue_requested: false,
            return_val: None,
            exit_requested: false,
            exit_status: 0,
            runtime_err: None,
            rng_state: 1,
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
            "OFMT" => self.ofmt.clone(),
            "CONVFMT" => self.convfmt.clone(),
            _ => self.vars.get(name).cloned().unwrap_or_default(),
        }
    }

    fn set_var(&mut self, name: &str, val: String) {
        self.numeric_vars.remove(name);
        match name {
            "FS" => self.fs = val,
            "RS" => self.rs = val,
            "OFS" => self.ofs = val,
            "ORS" => self.ors = val,
            "OFMT" => self.ofmt = val,
            "CONVFMT" => self.convfmt = val,
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

fn is_valid_awk_ident(name: &str) -> bool {
    !name.is_empty()
        && name.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn cmd_awk(args: &[String], stdin: &str, cwd: &str, env: &BTreeMap<String, String>, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut field_sep = " ".to_string();
    let mut vars = BTreeMap::new();
    let mut program_parts: Vec<String> = Vec::new();
    let mut saw_explicit_prog = false;
    let mut positionals: Vec<String> = Vec::new();
    let mut end_of_opts = false;

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !end_of_opts && a == "--" {
            end_of_opts = true;
            i += 1;
            continue;
        }
        if !end_of_opts && a == "-F" {
            if i + 1 >= args.len() {
                return err_out("awk: option requires an argument -- 'F'\n", 2);
            }
            i += 1;
            field_sep = unescape_sed_text(&args[i]);
        } else if !end_of_opts && let Some(rest) = a.strip_prefix("-F").or_else(|| a.strip_prefix("--field-separator=")) {
            field_sep = unescape_sed_text(rest);
        } else if !end_of_opts && a == "--field-separator" {
            if i + 1 >= args.len() {
                return err_out("awk: option requires an argument -- 'field-separator'\n", 2);
            }
            i += 1;
            field_sep = unescape_sed_text(&args[i]);
        } else if !end_of_opts && (a == "-v" || a == "--assign") {
            if i + 1 >= args.len() {
                return err_out("awk: option requires an argument -- 'v'\n", 2);
            }
            i += 1;
            if let Some((k, v)) = args[i].split_once('=') {
                if !is_valid_awk_ident(k) {
                    return err_out(&format!("awk: `{k}' is not a legal variable name\n"), 2);
                }
                vars.insert(k.to_string(), unescape_sed_text(v));
            } else {
                return err_out(&format!("awk: `{}' is not a legal variable name\n", args[i]), 2);
            }
        } else if !end_of_opts && let Some(rest) = a.strip_prefix("-v").or_else(|| a.strip_prefix("--assign=")) {
            if let Some((k, v)) = rest.split_once('=') {
                if !is_valid_awk_ident(k) {
                    return err_out(&format!("awk: `{k}' is not a legal variable name\n"), 2);
                }
                vars.insert(k.to_string(), unescape_sed_text(v));
            } else {
                return err_out(&format!("awk: `{rest}' is not a legal variable name\n"), 2);
            }
        } else if !end_of_opts && (a == "-e" || a == "--source") {
            if i + 1 >= args.len() {
                return err_out("awk: option requires an argument -- 'e'\n", 2);
            }
            i += 1;
            saw_explicit_prog = true;
            program_parts.push(args[i].clone());
        } else if !end_of_opts && let Some(rest) = a.strip_prefix("-e").or_else(|| a.strip_prefix("--source=")) {
            saw_explicit_prog = true;
            program_parts.push(rest.to_string());
        } else if !end_of_opts && (a == "-f" || a == "--file" || a == "-i" || a == "--include") {
            let is_prog_file = a == "-f" || a == "--file";
            if i + 1 >= args.len() {
                return err_out("awk: option requires an argument -- 'f'\n", 2);
            }
            i += 1;
            let p = resolve_posix_path(cwd, &args[i]);
            match fs.read_file(&p) {
                Ok(b) => {
                    if is_prog_file {
                        saw_explicit_prog = true;
                    }
                    program_parts.push(String::from_utf8_lossy(&b).into_owned());
                }
                Err(_) => return err_out(&format!("awk: can't open file {}\n", args[i]), 2),
            }
        } else if !end_of_opts && let Some(rest) = a.strip_prefix("-f").or_else(|| a.strip_prefix("--file=")) {
            let p = resolve_posix_path(cwd, rest);
            match fs.read_file(&p) {
                Ok(b) => {
                    saw_explicit_prog = true;
                    program_parts.push(String::from_utf8_lossy(&b).into_owned());
                }
                Err(_) => return err_out(&format!("awk: can't open file {rest}\n"), 2),
            }
        } else if !end_of_opts && let Some(rest) = a.strip_prefix("-i").or_else(|| a.strip_prefix("--include=")) {
            let p = resolve_posix_path(cwd, rest);
            match fs.read_file(&p) {
                Ok(b) => {
                    program_parts.push(String::from_utf8_lossy(&b).into_owned());
                }
                Err(_) => return err_out(&format!("awk: can't open file {rest}\n"), 2),
            }
        } else if !end_of_opts && (a == "-l" || a == "--load") {
            if i + 1 < args.len() {
                i += 1;
            }
        } else if !end_of_opts && (a.starts_with("-l") || a.starts_with("--load=")) {
            // loaded extension
        } else if !end_of_opts && (a == "-W" || a == "--posix" || a == "--traditional" || a == "--re-interval") {
            if a == "-W" && i + 1 < args.len() {
                i += 1;
            }
        } else if !end_of_opts && a.starts_with('-') && a != "-" {
            return err_out(&format!("awk: invalid option -- '{a}'\n"), 2);
        } else {
            positionals.push(a.clone());
        }
        i += 1;
    }

    let files: Vec<String> = if saw_explicit_prog {
        positionals
    } else if let Some((first, rest)) = positionals.split_first() {
        program_parts.push(first.clone());
        rest.to_vec()
    } else {
        Vec::new()
    };

    if program_parts.is_empty() {
        return err_out("awk: missing program\n", 2);
    }
    let prog_str = program_parts.join("\n");

    let (mut rules, funcs) = parse_awk_rules(&prog_str);
    let mut state = AwkState::new(field_sep, vars, funcs, cwd, fs);
    state.arrays.insert("ENVIRON".to_string(), env.clone());
    state.set_var("ARGC", (files.len() + 1).to_string());
    let mut argv_map = BTreeMap::new();
    argv_map.insert("0".to_string(), "awk".to_string());
    for (idx, f) in files.iter().enumerate() {
        argv_map.insert((idx + 1).to_string(), f.clone());
    }
    state.arrays.insert("ARGV".to_string(), argv_map);

    for r in &rules {
        if matches!(r.cond, AwkCond::Begin) {
            exec_awk_block(&r.body, &mut state);
            if let Some(err) = &state.runtime_err {
                return err_out(err, 2);
            }
            if state.exit_requested {
                break;
            }
        }
    }

    let needs_input = !state.exit_requested
        && rules.iter().any(|r| !matches!(r.cond, AwkCond::Begin));

    if needs_input {
        let mut arg_idx = 1usize;
        let initial_argc = parse_awk_f64(&state.get_var("ARGC")).max(0.0) as usize;
        let use_stdin_only = files.is_empty() && initial_argc <= 1;
        let mut stdin_done = false;

        'input_loop: loop {
            let (fname, content) = if use_stdin_only {
                if stdin_done {
                    break;
                }
                stdin_done = true;
                ("".to_string(), stdin.to_string())
            } else {
                let cur_argc = parse_awk_f64(&state.get_var("ARGC")).max(0.0) as usize;
                if arg_idx >= cur_argc {
                    break;
                }
                let f = state
                    .arrays
                    .get("ARGV")
                    .and_then(|m| m.get(&arg_idx.to_string()))
                    .cloned()
                    .unwrap_or_default();
                arg_idx += 1;
                if f.is_empty() {
                    continue 'input_loop;
                }
                if f == "-" {
                    ("-".to_string(), stdin.to_string())
                } else if let Some((k, v)) = f.split_once('=')
                    && is_valid_awk_ident(k)
                    && !f.contains('/')
                    && !fs.exists(&resolve_posix_path(cwd, &f))
                {
                    state.set_var(k, unescape_sed_text(v));
                    continue 'input_loop;
                } else {
                    let full = resolve_posix_path(cwd, &f);
                    match fs.read_file(&full) {
                        Ok(b) => (f, String::from_utf8_lossy(&b).into_owned()),
                        Err(_) => return err_out(&format!("awk: can't open file {f}\n"), 2),
                    }
                }
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
                    if let Some(err) = &state.runtime_err {
                        return err_out(err, 2);
                    }
                    if state.exit_requested {
                        break 'input_loop;
                    }
                    if state.nextfile_requested || state.next_requested {
                        break;
                    }
                }
                if let Some(err) = &state.runtime_err {
                    return err_out(err, 2);
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
    state.exit_requested = false;
    for r in &rules {
        if matches!(r.cond, AwkCond::End) {
            exec_awk_block(&r.body, &mut state);
            if let Some(err) = &state.runtime_err {
                return err_out(err, 2);
            }
            if state.exit_requested {
                break;
            }
        }
    }

    BuiltinOutcome {
        stdout: state.output,
        stderr: String::new(),
        exit_code: ((state.exit_status % 256) + 256) % 256,
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
    if is_single_awk_regex_literal(e) {
        let pat = e[1..e.len() - 1].replace("\\/", "/");
        return ZeroRegex::new(vec![pat], false, false, false, false)
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
                        let cur_ts = cur.trim_start();
                        if rest.trim_start().starts_with("else") && cur_ts.starts_with("if") {
                            idx += 1;
                            continue;
                        }
                        if rest.trim_start().starts_with("while")
                            && (cur_ts.starts_with("do ") || cur_ts.starts_with("do\t") || cur_ts.starts_with("do\n") || cur_ts.starts_with("do{"))
                        {
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
    let mut idx = 0usize;
    while idx < chars.len() {
        let c = chars[idx];
        if c == '\\' && idx + 1 < chars.len() {
            idx += 2;
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
        idx += 1;
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
    let mut idx = 0usize;
    while idx < chars.len() {
        let c = chars[idx];
        if c == '\\' && idx + 1 < chars.len() {
            idx += 2;
            continue;
        }
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
        idx += 1;
    }
    depth == 0
}

fn is_awk_numeric_expr(expr: &str, val: &str, state: &AwkState) -> bool {
    let e = expr.trim();
    if val.trim().parse::<f64>().is_err() {
        return false;
    }
    if is_single_awk_string_literal(e) || split_awk_concat(e).is_some() {
        return false;
    }
    if let Some(open) = e.find('(') && e.ends_with(')') {
        let fn_name = e[..open].trim();
        if matches!(fn_name, "sprintf" | "substr" | "tolower" | "toupper" | "gensub" | "chr") {
            return false;
        }
    }
    if is_valid_awk_ident(e) {
        return state.numeric_vars.contains(e);
    }
    if e.starts_with('$') || e.contains('[') {
        return false;
    }
    true
}

fn exec_awk_block(block: &str, state: &mut AwkState) {
    let stmts = split_awk_statements(block);
    let mut idx = 0usize;
    while idx < stmts.len() {
        if state.next_requested
            || state.nextfile_requested
            || state.break_requested
            || state.continue_requested
            || state.return_val.is_some()
            || state.exit_requested
            || state.runtime_err.is_some()
        {
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
        if stmt == "break" {
            state.break_requested = true;
            return;
        }
        if stmt == "continue" {
            state.continue_requested = true;
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
        if stmt == "exit" || stmt.starts_with("exit ") || stmt.starts_with("exit(") {
            let code_str = stmt.strip_prefix("exit").unwrap_or("").trim();
            if !code_str.is_empty() {
                let evaluated = eval_awk_expr(code_str, state);
                state.exit_status = parse_awk_f64(&evaluated) as i32;
            }
            state.exit_requested = true;
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
        if stmt.starts_with("do")
            && (stmt[2..].starts_with(' ')
                || stmt[2..].starts_with('\t')
                || stmt[2..].starts_with('\n')
                || stmt[2..].starts_with('{'))
        {
            exec_awk_do_while(stmt, state);
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
                let mut vals = Vec::with_capacity(args.len());
                for a in &args {
                    let v = eval_awk_expr(a, state);
                    if is_awk_numeric_expr(a, &v, state)
                        && let Ok(num) = v.trim().parse::<f64>()
                        && num.fract() != 0.0
                        && state.ofmt != "%.6g"
                    {
                        vals.push(format_awk_printf(&state.ofmt, &[v]));
                    } else {
                        vals.push(v);
                    }
                }
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
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '\\' && i + 1 < chars.len() {
            i += 2;
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
        i += 1;
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
        let mut bi = 0usize;
        while bi < b_chars.len() {
            if b_chars[bi] == '\\' && bi + 1 < b_chars.len() {
                bi += 2;
                continue;
            }
            if b_chars[bi] == '"' {
                bq = !bq;
            } else if !bq {
                if b_chars[bi] == '{' {
                    b_depth += 1;
                } else if b_chars[bi] == '}' {
                    b_depth -= 1;
                    if b_depth == 0 {
                        b_close = Some(bi);
                        break;
                    }
                }
            }
            bi += 1;
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
            if state.break_requested {
                state.break_requested = false;
                break;
            }
            if state.continue_requested {
                state.continue_requested = false;
            }
            if state.next_requested
                || state.nextfile_requested
                || state.return_val.is_some()
                || state.exit_requested
                || state.runtime_err.is_some()
            {
                break;
            }
            guard += 1;
        }
    }
}

fn exec_awk_do_while(stmt: &str, state: &mut AwkState) {
    let rest = stmt.strip_prefix("do").unwrap_or("").trim();
    let (body, after_body) = if rest.starts_with('{') {
        let b_chars: Vec<char> = rest.chars().collect();
        let mut b_depth = 0i32;
        let mut bq = false;
        let mut b_close = None;
        let mut bi = 0usize;
        while bi < b_chars.len() {
            if b_chars[bi] == '\\' && bi + 1 < b_chars.len() {
                bi += 2;
                continue;
            }
            if b_chars[bi] == '"' {
                bq = !bq;
            } else if !bq {
                if b_chars[bi] == '{' {
                    b_depth += 1;
                } else if b_chars[bi] == '}' {
                    b_depth -= 1;
                    if b_depth == 0 {
                        b_close = Some(bi);
                        break;
                    }
                }
            }
            bi += 1;
        }
        let Some(bc) = b_close else { return };
        let b: String = b_chars[1..bc].iter().collect();
        let rem: String = b_chars[bc + 1..].iter().collect();
        (b, rem)
    } else {
        return;
    };
    let rem_trim = after_body.trim();
    let Some(while_rest) = rem_trim.strip_prefix("while") else { return };
    let cond_raw = while_rest.trim().trim_end_matches(';').trim();
    let cond = if cond_raw.starts_with('(') && cond_raw.ends_with(')') && is_awk_outer_parens(cond_raw) {
        &cond_raw[1..cond_raw.len() - 1]
    } else {
        cond_raw
    };
    let mut guard = 0usize;
    loop {
        exec_awk_block(&body, state);
        if state.break_requested {
            state.break_requested = false;
            break;
        }
        if state.continue_requested {
            state.continue_requested = false;
        }
        if state.next_requested
            || state.nextfile_requested
            || state.return_val.is_some()
            || state.exit_requested
            || state.runtime_err.is_some()
        {
            break;
        }
        guard += 1;
        if guard >= 50_000 || !eval_awk_cond(cond, state) {
            break;
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
                if state.break_requested {
                    state.break_requested = false;
                    break;
                }
                if state.continue_requested {
                    state.continue_requested = false;
                }
                if state.next_requested
                    || state.nextfile_requested
                    || state.return_val.is_some()
                    || state.exit_requested
                    || state.runtime_err.is_some()
                {
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
                    if state.break_requested {
                        state.break_requested = false;
                        break;
                    }
                    if state.continue_requested {
                        state.continue_requested = false;
                    }
                    if state.next_requested
                        || state.nextfile_requested
                        || state.return_val.is_some()
                        || state.exit_requested
                        || state.runtime_err.is_some()
                    {
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

fn is_single_awk_regex_literal(s: &str) -> bool {
    if !s.starts_with('/') || !s.ends_with('/') || s.len() < 2 {
        return false;
    }
    let inner = &s[1..s.len() - 1];
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            let _ = chars.next();
        } else if c == '/' {
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
    if is_single_awk_regex_literal(s) {
        let pat = s[1..s.len() - 1].replace("\\/", "/");
        let matched = ZeroRegex::new(vec![pat], false, false, false, false).is_match(&state.line);
        return if matched { "1".to_string() } else { "0".to_string() };
    }

    for op in ["+=", "-=", "*=", "/=", "%=", "^=", "="] {
        if let Some((lhs, rhs)) = split_awk_binary_once(s, op) {
            if op == "=" && (lhs.ends_with('!') || lhs.ends_with('<') || lhs.ends_with('>') || lhs.ends_with('=')) {
                continue;
            }
            let rval = eval_awk_expr(&rhs, state);
            let is_num_rhs = if op == "=" {
                is_awk_numeric_expr(&rhs, &rval, state)
            } else {
                true
            };
            let final_val = if op == "=" {
                rval
            } else {
                let lnum = parse_awk_f64(&eval_awk_expr(&lhs, state));
                let rnum = parse_awk_f64(&rval);
                if (op == "/=" || op == "%=") && rnum == 0.0 {
                    state.runtime_err = Some("awk: division by zero\n".to_string());
                    return "0".to_string();
                }
                let res = match op {
                    "+=" => lnum + rnum,
                    "-=" => lnum - rnum,
                    "*=" => lnum * rnum,
                    "/=" => lnum / rnum,
                    "%=" => lnum % rnum,
                    "^=" => lnum.powf(rnum),
                    _ => rnum,
                };
                format_awk_num(res)
            };
            assign_awk_lvalue(&lhs, final_val.clone(), state);
            let lv_trim = lhs.trim();
            if is_num_rhs && is_valid_awk_ident(lv_trim) {
                state.numeric_vars.insert(lv_trim.to_string());
            }
            return final_val;
        }
    }

    if let Some(var) = s.strip_suffix("++") {
        let v = var.trim();
        let old_val = parse_awk_f64(&eval_awk_expr(v, state));
        assign_awk_lvalue(v, format_awk_num(old_val + 1.0), state);
        if is_valid_awk_ident(v) {
            state.numeric_vars.insert(v.to_string());
        }
        return format_awk_num(old_val);
    }
    if let Some(var) = s.strip_prefix("++") {
        let v = var.trim();
        let new_val = parse_awk_f64(&eval_awk_expr(v, state)) + 1.0;
        let formatted = format_awk_num(new_val);
        assign_awk_lvalue(v, formatted.clone(), state);
        if is_valid_awk_ident(v) {
            state.numeric_vars.insert(v.to_string());
        }
        return formatted;
    }
    if let Some(var) = s.strip_suffix("--") {
        let v = var.trim();
        let old_val = parse_awk_f64(&eval_awk_expr(v, state));
        assign_awk_lvalue(v, format_awk_num(old_val - 1.0), state);
        if is_valid_awk_ident(v) {
            state.numeric_vars.insert(v.to_string());
        }
        return format_awk_num(old_val);
    }
    if let Some(var) = s.strip_prefix("--")
        && !var.starts_with('-')
    {
        let v = var.trim();
        let new_val = parse_awk_f64(&eval_awk_expr(v, state)) - 1.0;
        let formatted = format_awk_num(new_val);
        assign_awk_lvalue(v, formatted.clone(), state);
        if is_valid_awk_ident(v) {
            state.numeric_vars.insert(v.to_string());
        }
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
            let v = eval_awk_expr(&p, state);
            if is_awk_numeric_expr(&p, &v, state)
                && let Ok(num) = v.trim().parse::<f64>()
                && num.fract() != 0.0
                && state.convfmt != "%.6g"
            {
                joined.push_str(&format_awk_printf(&state.convfmt, &[v]));
            } else {
                joined.push_str(&v);
            }
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
            if (op == "/" || op == "%") && rn == 0.0 {
                state.runtime_err = Some("awk: division by zero\n".to_string());
                return "0".to_string();
            }
            let res = match op {
                "*" => ln * rn,
                "/" => ln / rn,
                "%" => ln % rn,
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
        "srand" => {
            let old_seed = state.rng_state;
            let new_seed = if let Some(first) = args.first() {
                parse_awk_f64(&eval_awk_expr(first, state)) as i64 as u32
            } else {
                1
            };
            state.rng_state = if new_seed == 0 { 1 } else { new_seed };
            Some(old_seed.to_string())
        }
        "rand" => {
            state.rng_state = state.rng_state.wrapping_mul(1664525).wrapping_add(1013904223);
            let val = (state.rng_state as f64) / 4294967296.0;
            Some(format_awk_num(val))
        }
        "fflush" => Some("0".to_string()),
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
        !t.ends_with("++") && !t.ends_with("--") && (t.ends_with(['+', '-', '*', '/', '%', '^']) || t == "!")
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

fn format_c_scientific(n: f64, prec: usize, upper: bool, alt_form: bool) -> String {
    let is_neg = n.is_sign_negative() && n != 0.0;
    let abs_n = n.abs();
    let (mant, exp) = if abs_n == 0.0 {
        (0.0, 0i32)
    } else {
        let mut e = abs_n.log10().floor() as i32;
        let mut m = abs_n / 10f64.powi(e);
        let factor = 10f64.powi(prec as i32);
        if (m * factor).round() / factor >= 10.0 {
            e += 1;
            m /= 10.0;
        }
        (m, e)
    };
    let mut m_str = format!("{mant:.prec$}");
    if alt_form && prec == 0 && !m_str.contains('.') {
        m_str.push('.');
    }
    let e_ch = if upper { 'E' } else { 'e' };
    let exp_sign = if exp >= 0 { '+' } else { '-' };
    let exp_abs = exp.unsigned_abs();
    let sign_prefix = if is_neg { "-" } else { "" };
    format!("{sign_prefix}{m_str}{e_ch}{exp_sign}{exp_abs:02}")
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
            let mut left_align = false;
            let mut force_sign = false;
            let mut space_sign = false;
            let mut alt_form = false;
            let mut zero_pad = false;
            while i < chars.len() {
                match chars[i] {
                    '-' => left_align = true,
                    '+' => force_sign = true,
                    ' ' => space_sign = true,
                    '#' => alt_form = true,
                    '0' => zero_pad = true,
                    _ => break,
                }
                i += 1;
            }
            let width: usize = if i < chars.len() && chars[i] == '*' {
                i += 1;
                let w_val = vals.get(arg_idx).map(|s| parse_awk_f64(s) as i64).unwrap_or(0);
                arg_idx += 1;
                if w_val < 0 {
                    left_align = true;
                    (-w_val) as usize
                } else {
                    w_val as usize
                }
            } else {
                let mut w_str = String::new();
                while i < chars.len() && chars[i].is_ascii_digit() {
                    w_str.push(chars[i]);
                    i += 1;
                }
                w_str.parse::<usize>().unwrap_or(0)
            };
            let prec: Option<usize> = if i < chars.len() && chars[i] == '.' {
                i += 1;
                if i < chars.len() && chars[i] == '*' {
                    i += 1;
                    let p_val = vals.get(arg_idx).map(|s| parse_awk_f64(s) as i64).unwrap_or(0);
                    arg_idx += 1;
                    Some(p_val.max(0) as usize)
                } else {
                    let mut p_str = String::new();
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        p_str.push(chars[i]);
                        i += 1;
                    }
                    Some(p_str.parse::<usize>().unwrap_or(0))
                }
            } else {
                None
            };
            while i < chars.len() && matches!(chars[i], 'l' | 'h' | 'L') {
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
            let (raw_body, is_num, allow_sign) = match conv {
                'd' | 'i' => {
                    let n = parse_awk_f64(&val) as i64;
                    (n.to_string(), true, true)
                }
                'u' => {
                    let n = (parse_awk_f64(&val) as i64) as u64;
                    (n.to_string(), true, false)
                }
                'f' | 'F' => {
                    let n = parse_awk_f64(&val);
                    let p = prec.unwrap_or(6);
                    let mut s = format!("{n:.p$}");
                    if alt_form && p == 0 && !s.contains('.') {
                        s.push('.');
                    }
                    (s, true, true)
                }
                'e' | 'E' => {
                    let n = parse_awk_f64(&val);
                    let p = prec.unwrap_or(6);
                    (format_c_scientific(n, p, conv == 'E', alt_form), true, true)
                }
                'g' | 'G' => {
                    let n = parse_awk_f64(&val);
                    let p = prec.unwrap_or(6).max(1);
                    let abs_n = n.abs();
                    let exp = if abs_n == 0.0 { 0 } else { abs_n.log10().floor() as i32 };
                    let s = if exp < -4 || exp >= p as i32 {
                        let sci = format_c_scientific(n, p - 1, conv == 'G', alt_form);
                        if !alt_form {
                            let e_ch = if conv == 'G' { 'E' } else { 'e' };
                            if let Some((m, ex)) = sci.split_once(e_ch) {
                                let m_clean = if m.contains('.') {
                                    m.trim_end_matches('0').trim_end_matches('.')
                                } else {
                                    m
                                };
                                format!("{m_clean}{e_ch}{ex}")
                            } else {
                                sci
                            }
                        } else {
                            sci
                        }
                    } else {
                        let dec_places = (p as i32 - 1 - exp).max(0) as usize;
                        let mut fx = format!("{n:.dec_places$}");
                        if !alt_form {
                            if fx.contains('.') {
                                fx = fx.trim_end_matches('0').trim_end_matches('.').to_string();
                            }
                        } else if !fx.contains('.') {
                            fx.push('.');
                        }
                        fx
                    };
                    (s, true, true)
                }
                'x' | 'X' => {
                    let n = (parse_awk_f64(&val) as i64) as u64;
                    let hex = if conv == 'X' { format!("{n:X}") } else { format!("{n:x}") };
                    let s = if alt_form && n != 0 {
                        if conv == 'X' { format!("0X{hex}") } else { format!("0x{hex}") }
                    } else {
                        hex
                    };
                    (s, true, false)
                }
                'o' => {
                    let n = (parse_awk_f64(&val) as i64) as u64;
                    let oct = format!("{n:o}");
                    let s = if alt_form && !oct.starts_with('0') {
                        format!("0{oct}")
                    } else {
                        oct
                    };
                    (s, true, false)
                }
                'c' => {
                    let ch_str = if let Ok(n) = val.parse::<u32>() {
                        char::from_u32(n).map(|c| c.to_string()).unwrap_or_default()
                    } else {
                        val.chars().next().map(|c| c.to_string()).unwrap_or_default()
                    };
                    (ch_str, false, false)
                }
                _ => {
                    let truncated = if let Some(p) = prec {
                        val.chars().take(p).collect::<String>()
                    } else {
                        val
                    };
                    (truncated, false, false)
                }
            };
            let signed_val = if allow_sign && !raw_body.starts_with('-') && !raw_body.starts_with('+') {
                if force_sign {
                    format!("+{raw_body}")
                } else if space_sign {
                    format!(" {raw_body}")
                } else {
                    raw_body
                }
            } else {
                raw_body
            };
            let len = signed_val.chars().count();
            if width <= len {
                out.push_str(&signed_val);
            } else {
                let pad_len = width - len;
                if left_align {
                    out.push_str(&signed_val);
                    out.push_str(&" ".repeat(pad_len));
                } else if zero_pad && is_num {
                    if let Some(rest) = signed_val.strip_prefix('-') {
                        out.push('-');
                        out.push_str(&"0".repeat(pad_len));
                        out.push_str(rest);
                    } else if let Some(rest) = signed_val.strip_prefix('+') {
                        out.push('+');
                        out.push_str(&"0".repeat(pad_len));
                        out.push_str(rest);
                    } else {
                        out.push_str(&"0".repeat(pad_len));
                        out.push_str(&signed_val);
                    }
                } else {
                    out.push_str(&" ".repeat(pad_len));
                    out.push_str(&signed_val);
                }
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
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
    recursive: bool,
    brief: bool,
    report_identical: bool,
    ignore_case: bool,
    ignore_all_space: bool,
    ignore_space_change: bool,
    ignore_tab_expansion: bool,
    ignore_trailing_space: bool,
    ignore_blank_lines: bool,
    strip_trailing_cr: bool,
    text: bool,
    ignore_file_name_case: bool,
    expand_tabs: bool,
    initial_tab: bool,
    left_column: bool,
    suppress_common: bool,
    no_deref: bool,
    show_c_func: bool,
    show_func_regexes: Vec<String>,
    width: usize,
    ifdef_macro: String,
    labels: Vec<String>,
    ignore_regexes: Vec<String>,
    excludes: Vec<String>,
    starting_file: Option<String>,
    option_args: Vec<String>,
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

fn expand_tabs_line(line: &str) -> String {
    let mut column = 0usize;
    let mut result = String::new();
    for ch in line.chars() {
        if ch == '\t' {
            let count = 8 - (column % 8);
            result.extend(std::iter::repeat_n(' ', count));
            column += count;
        } else {
            result.push(ch);
            if ch == '\r' {
                column = 0;
            } else if ch == '\x08' {
                column = column.saturating_sub(1);
            } else {
                column += 1;
            }
        }
    }
    result
}

fn sbs_clipped(line: &str, width: usize, expand: bool) -> (String, usize) {
    let mut column = 0usize;
    let mut text = String::new();
    for ch in line.chars() {
        if ch == '\n' {
            break;
        }
        let next = if ch == '\t' {
            column + 8 - (column % 8)
        } else {
            column + 1
        };
        if next > width {
            break;
        }
        if ch == '\t' && expand {
            text.extend(std::iter::repeat_n(' ', next - column));
        } else {
            text.push(ch);
        }
        column = next;
    }
    (text, column)
}

fn sbs_padding(mut column: usize, target: usize, expand: bool) -> String {
    let mut result = String::new();
    if !expand {
        while column + 8 - (column % 8) <= target {
            result.push('\t');
            column += 8 - (column % 8);
        }
    }
    if target > column {
        result.extend(std::iter::repeat_n(' ', target - column));
    }
    result
}

fn quote_diff_arg(argument: &str) -> String {
    let mut needs_quotes = argument.is_empty() || argument.starts_with('~');
    let mut double_quotes = argument.contains('\'');
    for ch in argument.chars() {
        if " \t\n\r!\"$&'()*;<=>?[\\^`|".contains(ch) {
            needs_quotes = true;
        }
        if !" %'+,-./0123456789:@ABCDEFGHIJKLMNOPQRSTUVWXYZ]_abcdefghijklmnopqrstuvwxyz".contains(ch) {
            double_quotes = false;
        }
    }
    if !needs_quotes {
        return argument.to_string();
    }
    if double_quotes {
        return format!("\"{argument}\"");
    }
    format!("'{}'", argument.replace('\'', "'\\''"))
}

fn split_diff_lines(text: &str) -> Vec<(&str, bool)> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut start = 0usize;
    for (idx, b) in text.bytes().enumerate() {
        if b == b'\n' {
            out.push((&text[start..idx], true));
            start = idx + 1;
        }
    }
    if start < text.len() {
        out.push((&text[start..], false));
    }
    out
}

struct DiffChange {
    kind: char,
    old_idx: Option<usize>,
    new_idx: Option<usize>,
    ignored: bool,
}

#[allow(clippy::too_many_arguments)]
fn diff_two_texts(
    label_a: &str,
    label_b: &str,
    text_a: &str,
    text_b: &str,
    opts: &DiffOpts,
) -> (String, bool) {
    let format = opts.format.unwrap_or(if !opts.show_func_regexes.is_empty() || opts.show_c_func {
        DiffFormat::Context
    } else {
        DiffFormat::Normal
    });
    let brief = opts.brief;
    let report_identical = opts.report_identical;
    let ignore_case = opts.ignore_case;
    let ignore_blank_lines = opts.ignore_blank_lines;

    let owned_a;
    let owned_b;
    let eff_a = if opts.strip_trailing_cr && text_a.contains("\r\n") {
        owned_a = text_a.replace("\r\n", "\n");
        owned_a.as_str()
    } else {
        text_a
    };
    let eff_b = if opts.strip_trailing_cr && text_b.contains("\r\n") {
        owned_b = text_b.replace("\r\n", "\n");
        owned_b.as_str()
    } else {
        text_b
    };

    let ws_ignores_eof_nl = opts.ignore_all_space
        || opts.ignore_space_change
        || opts.ignore_trailing_space
        || opts.ignore_tab_expansion;

    let norm_line = |l: &str, has_nl: bool| -> String {
        let mut s = if opts.ignore_tab_expansion {
            expand_tabs_line(l)
        } else {
            l.to_string()
        };
        if opts.ignore_all_space {
            s.retain(|c| !matches!(c, ' ' | '\t' | '\x0b' | '\x0c' | '\r'));
        } else if opts.ignore_space_change {
            let mut out_s = String::new();
            let mut prev_ws = false;
            for c in s.chars() {
                let is_ws = matches!(c, ' ' | '\t' | '\x0b' | '\x0c' | '\r');
                if is_ws {
                    if !prev_ws {
                        out_s.push(' ');
                    }
                } else {
                    out_s.push(c);
                }
                prev_ws = is_ws;
            }
            s = out_s.trim_end_matches(' ').to_string();
        } else if opts.ignore_trailing_space {
            s = s.trim_end_matches([' ', '\t', '\x0b', '\x0c', '\r']).to_string();
        }
        if ignore_case {
            s = s.to_ascii_lowercase();
        }
        if !ws_ignores_eof_nl && (has_nl || (format == DiffFormat::Ed && !brief)) {
            s.push('\n');
        }
        s
    };

    let raw_a = split_diff_lines(eff_a);
    let raw_b = split_diff_lines(eff_b);
    let lines_a: Vec<&str> = raw_a.iter().map(|(l, _)| *l).collect();
    let lines_b: Vec<&str> = raw_b.iter().map(|(l, _)| *l).collect();
    let nl_a: Vec<bool> = raw_a
        .iter()
        .map(|(_, nl)| *nl || (format == DiffFormat::Ed && !brief))
        .collect();
    let nl_b: Vec<bool> = raw_b
        .iter()
        .map(|(_, nl)| *nl || (format == DiffFormat::Ed && !brief))
        .collect();

    let norm_a: Vec<String> = raw_a.iter().map(|(l, nl)| norm_line(l, *nl)).collect();
    let norm_b: Vec<String> = raw_b.iter().map(|(l, nl)| norm_line(l, *nl)).collect();

    let same_keys = norm_a == norm_b;
    if same_keys && format != DiffFormat::Ifdef && format != DiffFormat::SideBySide {
        if report_identical {
            return (format!("Files {label_a} and {label_b} are identical\n"), false);
        }
        return (String::new(), false);
    }

    let edits = compute_lcs_edits(&norm_a, &norm_b);
    let mut changes: Vec<DiffChange> = Vec::with_capacity(edits.len());
    let mut cur_b_for_keep = 0usize;
    for e in &edits {
        match *e {
            DiffEdit::Keep(ia) => {
                changes.push(DiffChange {
                    kind: ' ',
                    old_idx: Some(ia),
                    new_idx: Some(cur_b_for_keep),
                    ignored: false,
                });
                cur_b_for_keep += 1;
            }
            DiffEdit::Delete(ia) => {
                changes.push(DiffChange {
                    kind: '-',
                    old_idx: Some(ia),
                    new_idx: None,
                    ignored: false,
                });
            }
            DiffEdit::Insert(ib) => {
                changes.push(DiffChange {
                    kind: '+',
                    old_idx: None,
                    new_idx: Some(ib),
                    ignored: false,
                });
                cur_b_for_keep = ib + 1;
            }
        }
    }

    if !same_keys && (ignore_blank_lines || !opts.ignore_regexes.is_empty()) {
        let rx = if opts.ignore_regexes.is_empty() {
            None
        } else {
            Some(ZeroRegex::new(
                opts.ignore_regexes.clone(),
                ignore_case,
                false,
                false,
                false,
            ))
        };
        let mut scan = 0usize;
        while scan < changes.len() {
            if changes[scan].kind == ' ' {
                scan += 1;
                continue;
            }
            let start = scan;
            let mut block_ignored = true;
            while scan < changes.len() && changes[scan].kind != ' ' {
                let body = match changes[scan].kind {
                    '-' => lines_a[changes[scan].old_idx.unwrap()],
                    '+' => lines_b[changes[scan].new_idx.unwrap()],
                    _ => "",
                };
                let blank_ok = ignore_blank_lines
                    && (body.is_empty()
                        || ((opts.ignore_all_space || opts.ignore_space_change)
                            && body
                                .chars()
                                .all(|c| matches!(c, ' ' | '\t' | '\x0b' | '\x0c' | '\r'))));
                let rx_ok = rx.as_ref().is_some_and(|r| r.is_match(body));
                if !blank_ok && !rx_ok {
                    block_ignored = false;
                }
                scan += 1;
            }
            if block_ignored {
                for item in &mut changes[start..scan] {
                    item.ignored = true;
                }
            }
        }
    }

    let differed = changes.iter().any(|c| c.kind != ' ' && !c.ignored);

    if !differed && format != DiffFormat::Ifdef && format != DiffFormat::SideBySide {
        if report_identical {
            return (format!("Files {label_a} and {label_b} are identical\n"), false);
        }
        return (String::new(), false);
    }

    if brief {
        if differed {
            return (format!("Files {label_a} and {label_b} differ\n"), true);
        }
        if report_identical {
            return (format!("Files {label_a} and {label_b} are identical\n"), false);
        }
        return (String::new(), false);
    }

    let fmt_line_with_nl = |prefix: &str, line: &str, has_nl: bool| -> String {
        let pfx = if opts.initial_tab {
            let base = if prefix.len() == 2 {
                &prefix[..1]
            } else {
                prefix.trim_end()
            };
            format!("{base}\t")
        } else {
            prefix.to_string()
        };
        let body = if opts.expand_tabs {
            expand_tabs_line(line)
        } else {
            line.to_string()
        };
        if has_nl {
            format!("{pfx}{body}\n")
        } else {
            format!("{pfx}{body}\n\\ No newline at end of file\n")
        }
    };

    let find_func_heading = |old_pos: usize| -> String {
        let mut patterns = opts.show_func_regexes.clone();
        if opts.show_c_func && patterns.is_empty() {
            patterns.push("^[A-Za-z_$]".to_string());
        }
        if patterns.is_empty() {
            return String::new();
        }
        let rx = ZeroRegex::new(patterns, false, false, false, false);
        let limit = old_pos.min(lines_a.len());
        lines_a[..limit]
            .iter()
            .rev()
            .find(|l| rx.is_match(l))
            .map(|l| {
                let truncated: String = l.chars().take(40).collect();
                format!(" {truncated}")
            })
            .unwrap_or_default()
    };

    let mut out = String::new();
    if format == DiffFormat::Unified || format == DiffFormat::Context {
        if format == DiffFormat::Unified {
            out.push_str(&format!("--- {label_a}\n+++ {label_b}\n"));
        } else {
            out.push_str(&format!("*** {label_a}\n--- {label_b}\n"));
        }
        let ctx = opts.ctx_lines.unwrap_or(3).min(changes.len());
        let unified_range = |start_pos: usize, count: usize| -> String {
            if count == 0 {
                format!("{start_pos},0")
            } else if count == 1 {
                format!("{}", start_pos + 1)
            } else {
                format!("{},{count}", start_pos + 1)
            }
        };
        let context_range = |start_pos: usize, count: usize| -> String {
            if count == 0 {
                format!("{start_pos}")
            } else if count == 1 {
                format!("{}", start_pos + 1)
            } else {
                format!("{},{}", start_pos + 1, start_pos + count)
            }
        };

        let mut scan = 0usize;
        let mut old_position = 0usize;
        let mut new_position = 0usize;
        while scan < changes.len() {
            let mut changed = scan;
            while changed < changes.len() && changes[changed].kind == ' ' {
                changed += 1;
            }
            if changed == changes.len() {
                break;
            }
            let start = changed.saturating_sub(ctx);
            let mut last_change = changed;
            let mut end = changed + 1;
            while end < changes.len() && end - last_change - 1 <= 2 * ctx {
                if changes[end].kind != ' ' {
                    if changes[end].ignored && end - last_change - 1 >= ctx {
                        break;
                    }
                    last_change = end;
                }
                end += 1;
            }
            end = (last_change + ctx + 1).min(changes.len());
            while scan > start {
                scan -= 1;
                if changes[scan].kind != '+' {
                    old_position -= 1;
                }
                if changes[scan].kind != '-' {
                    new_position -= 1;
                }
            }
            while scan < start {
                if changes[scan].kind != '+' {
                    old_position += 1;
                }
                if changes[scan].kind != '-' {
                    new_position += 1;
                }
                scan += 1;
            }
            let mut old_count = 0usize;
            let mut new_count = 0usize;
            let mut any_del = false;
            let mut any_ins = false;
            for item in &changes[start..end] {
                if item.kind != '+' {
                    old_count += 1;
                }
                if item.kind != '-' {
                    new_count += 1;
                }
                if item.kind == '-' {
                    any_del = true;
                }
                if item.kind == '+' {
                    any_ins = true;
                }
            }
            if !changes[start..end].iter().any(|c| c.kind != ' ' && !c.ignored) {
                old_position += old_count;
                new_position += new_count;
                scan = end;
                continue;
            }
            let func_heading = find_func_heading(old_position);
            if format == DiffFormat::Unified {
                out.push_str(&format!(
                    "@@ -{} +{} @@{func_heading}\n",
                    unified_range(old_position, old_count),
                    unified_range(new_position, new_count)
                ));
                for item in &changes[start..end] {
                    match item.kind {
                        ' ' => {
                            let ia = item.old_idx.unwrap();
                            out.push_str(&fmt_line_with_nl(" ", lines_a[ia], nl_a[ia]));
                        }
                        '-' => {
                            let ia = item.old_idx.unwrap();
                            out.push_str(&fmt_line_with_nl("-", lines_a[ia], nl_a[ia]));
                        }
                        '+' => {
                            let ib = item.new_idx.unwrap();
                            out.push_str(&fmt_line_with_nl("+", lines_b[ib], nl_b[ib]));
                        }
                        _ => {}
                    }
                }
            } else {
                out.push_str(&format!(
                    "***************{func_heading}\n*** {} ****\n",
                    context_range(old_position, old_count)
                ));
                if any_del {
                    let mut si = start;
                    while si < end {
                        if changes[si].kind == ' ' {
                            let ia = changes[si].old_idx.unwrap();
                            out.push_str(&fmt_line_with_nl("  ", lines_a[ia], nl_a[ia]));
                            si += 1;
                            continue;
                        }
                        let mut grp_del = false;
                        let mut grp_ins = false;
                        let mut ge = si;
                        while ge < end && changes[ge].kind != ' ' {
                            if changes[ge].kind == '-' {
                                grp_del = true;
                            } else {
                                grp_ins = true;
                            }
                            ge += 1;
                        }
                        let pfx = if grp_del && grp_ins { "! " } else { "- " };
                        while si < ge {
                            if changes[si].kind == '-' {
                                let ia = changes[si].old_idx.unwrap();
                                out.push_str(&fmt_line_with_nl(pfx, lines_a[ia], nl_a[ia]));
                            }
                            si += 1;
                        }
                    }
                }
                out.push_str(&format!("--- {} ----\n", context_range(new_position, new_count)));
                if any_ins {
                    let mut si = start;
                    while si < end {
                        if changes[si].kind == ' ' {
                            let ib = changes[si].new_idx.unwrap();
                            out.push_str(&fmt_line_with_nl("  ", lines_b[ib], nl_b[ib]));
                            si += 1;
                            continue;
                        }
                        let mut grp_del = false;
                        let mut grp_ins = false;
                        let mut ge = si;
                        while ge < end && changes[ge].kind != ' ' {
                            if changes[ge].kind == '-' {
                                grp_del = true;
                            } else {
                                grp_ins = true;
                            }
                            ge += 1;
                        }
                        let pfx = if grp_del && grp_ins { "! " } else { "+ " };
                        while si < ge {
                            if changes[si].kind == '+' {
                                let ib = changes[si].new_idx.unwrap();
                                out.push_str(&fmt_line_with_nl(pfx, lines_b[ib], nl_b[ib]));
                            }
                            si += 1;
                        }
                    }
                }
            }
            scan = end;
            old_position += old_count;
            new_position += new_count;
        }
    } else if format == DiffFormat::SideBySide {
        let width = if opts.width > 0 { opts.width } else { 130 };
        let mut half = width.saturating_sub(3) / 2;
        let mut right_start = width - half;
        if !opts.expand_tabs {
            right_start = ((width + 11) / 16) * 8;
            half = right_start.saturating_sub(3).min(width.saturating_sub(right_start));
            if half == 0 {
                right_start = width;
            }
        }
        let marker_col = (half + right_start).saturating_sub(1) / 2;

        let emit_row = |out: &mut String, left: Option<&str>, right: Option<&str>, marker: char| {
            if marker == ' ' && opts.suppress_common {
                return;
            }
            let (first_text, first_col) = sbs_clipped(left.unwrap_or(""), half, opts.expand_tabs);
            let mut row_text = first_text;
            if marker == ' ' && opts.left_column {
                row_text.push_str(&sbs_padding(first_col, marker_col, opts.expand_tabs));
                row_text.push('(');
                row_text.push('\n');
                out.push_str(&row_text);
                return;
            }
            if marker != ' ' {
                row_text.push_str(&sbs_padding(first_col, marker_col, opts.expand_tabs));
                row_text.push(marker);
            }
            if let Some(r) = right
                && !r.is_empty()
            {
                let col = if marker == ' ' { first_col } else { marker_col + 1 };
                let (second_text, _) = sbs_clipped(r, half, opts.expand_tabs);
                row_text.push_str(&sbs_padding(col, right_start, opts.expand_tabs));
                row_text.push_str(&second_text);
            }
            row_text.push('\n');
            out.push_str(&row_text);
        };

        let mut ei = 0usize;
        while ei < edits.len() {
            match edits[ei] {
                DiffEdit::Keep(ia) => {
                    emit_row(&mut out, Some(lines_a[ia]), Some(lines_a[ia]), ' ');
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
                    let max_n = dels.len().max(inss.len());
                    for k in 0..max_n {
                        let l = dels.get(k).copied();
                        let r = inss.get(k).copied();
                        let m = match (l, r) {
                            (None, Some(_)) => '>',
                            (Some(_), None) => '<',
                            _ => '|',
                        };
                        emit_row(&mut out, l, r, m);
                    }
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
                    let run_start = ei;
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
                    if changes[run_start].ignored {
                        for d in dels {
                            out.push_str(&format!("{d}\n"));
                        }
                        continue;
                    }
                    if !dels.is_empty() && !inss.is_empty() {
                        out.push_str(&format!("#ifndef {m}\n"));
                        for d in dels {
                            out.push_str(&format!("{d}\n"));
                        }
                        out.push_str(&format!("#else /* {m} */\n"));
                        for ins in inss {
                            out.push_str(&format!("{ins}\n"));
                        }
                        out.push_str(&format!("#endif /* {m} */\n"));
                    } else if !dels.is_empty() {
                        out.push_str(&format!("#ifndef {m}\n"));
                        for d in dels {
                            out.push_str(&format!("{d}\n"));
                        }
                        out.push_str(&format!("#endif /* ! {m} */\n"));
                    } else if !inss.is_empty() {
                        out.push_str(&format!("#ifdef {m}\n"));
                        for ins in inss {
                            out.push_str(&format!("{ins}\n"));
                        }
                        out.push_str(&format!("#endif /* {m} */\n"));
                    }
                }
            }
        }
    } else {
        let normal_range = |start_pos: usize, count: usize| -> String {
            if count == 0 {
                format!("{start_pos}")
            } else if count == 1 {
                format!("{}", start_pos + 1)
            } else {
                format!("{},{}", start_pos + 1, start_pos + count)
            }
        };
        if format == DiffFormat::Ed || format == DiffFormat::Rcs {
            let mut groups: Vec<(usize, Vec<usize>, Vec<usize>)> = Vec::new();
            let mut scan = 0usize;
            let mut pos = 0usize;
            while scan < changes.len() {
                if changes[scan].kind == ' ' {
                    pos += 1;
                    scan += 1;
                    continue;
                }
                let start = scan;
                let grp_pos = pos;
                let mut dels = Vec::new();
                let mut inss = Vec::new();
                while scan < changes.len() && changes[scan].kind != ' ' {
                    if changes[scan].kind == '-' {
                        dels.push(changes[scan].old_idx.unwrap());
                        pos += 1;
                    } else {
                        inss.push(changes[scan].new_idx.unwrap());
                    }
                    scan += 1;
                }
                if !changes[start].ignored {
                    groups.push((grp_pos, dels, inss));
                }
            }
            if format == DiffFormat::Ed {
                groups.reverse();
                for (grp_pos, dels, inss) in groups {
                    let start_1 = grp_pos + 1;
                    let end_1 = grp_pos + dels.len();
                    let range = if dels.len() > 1 {
                        format!("{start_1},{end_1}")
                    } else {
                        format!("{start_1}")
                    };
                    let addr = if dels.is_empty() {
                        format!("{grp_pos}")
                    } else {
                        range
                    };
                    let cmd_ch = if dels.is_empty() {
                        'a'
                    } else if inss.is_empty() {
                        'd'
                    } else {
                        'c'
                    };
                    out.push_str(&format!("{addr}{cmd_ch}\n"));
                    if !inss.is_empty() {
                        for (idx_ins, &ib) in inss.iter().enumerate() {
                            let l = lines_b[ib];
                            if l == "." {
                                out.push_str("..\n.\ns/.//\n");
                                if idx_ins + 1 < inss.len() {
                                    out.push_str("a\n");
                                }
                            } else {
                                out.push_str(&format!("{l}\n"));
                            }
                        }
                        if lines_b[*inss.last().unwrap()] != "." {
                            out.push_str(".\n");
                        }
                    }
                }
            } else {
                for (grp_pos, dels, inss) in groups {
                    if !dels.is_empty() {
                        out.push_str(&format!("d{} {}\n", grp_pos + 1, dels.len()));
                    }
                    if !inss.is_empty() {
                        out.push_str(&format!("a{} {}\n", grp_pos + dels.len(), inss.len()));
                        for ib in inss {
                            out.push_str(lines_b[ib]);
                            if nl_b[ib] {
                                out.push('\n');
                            }
                        }
                    }
                }
            }
        } else {
            let mut scan = 0usize;
            let mut old_pos = 0usize;
            let mut new_pos = 0usize;
            while scan < changes.len() {
                if changes[scan].kind == ' ' {
                    old_pos += 1;
                    new_pos += 1;
                    scan += 1;
                    continue;
                }
                let start = scan;
                let mut old_count = 0usize;
                let mut new_count = 0usize;
                while scan < changes.len() && changes[scan].kind != ' ' {
                    if changes[scan].kind == '-' {
                        old_count += 1;
                    } else {
                        new_count += 1;
                    }
                    scan += 1;
                }
                if changes[start].ignored {
                    old_pos += old_count;
                    new_pos += new_count;
                    continue;
                }
                let op = if old_count == 0 {
                    'a'
                } else if new_count == 0 {
                    'd'
                } else {
                    'c'
                };
                out.push_str(&format!(
                    "{}{op}{}\n",
                    normal_range(old_pos, old_count),
                    normal_range(new_pos, new_count)
                ));
                for item in &changes[start..scan] {
                    if item.kind == '-' {
                        let ia = item.old_idx.unwrap();
                        out.push_str(&fmt_line_with_nl("< ", lines_a[ia], nl_a[ia]));
                    }
                }
                if old_count > 0 && new_count > 0 {
                    out.push_str("---\n");
                }
                for item in &changes[start..scan] {
                    if item.kind == '+' {
                        let ib = item.new_idx.unwrap();
                        out.push_str(&fmt_line_with_nl("> ", lines_b[ib], nl_b[ib]));
                    }
                }
                old_pos += old_count;
                new_pos += new_count;
            }
        }
    }
    if !differed && report_identical {
        out.push_str(&format!("Files {label_a} and {label_b} are identical\n"));
    }
    (out, differed)
}

fn diff_two_byte_inputs(
    path_a: &str,
    path_b: &str,
    label_a: &str,
    label_b: &str,
    bytes_a: &[u8],
    bytes_b: &[u8],
    nested: bool,
    opts: &DiffOpts,
    stderr: &mut String,
) -> (String, bool, bool) {
    let format = opts.format.unwrap_or(if !opts.show_func_regexes.is_empty() || opts.show_c_func {
        DiffFormat::Context
    } else {
        DiffFormat::Normal
    });
    let has_nul = bytes_a.contains(&0) || bytes_b.contains(&0);
    let mut trouble = false;
    let mut incomplete_ed = false;
    if format == DiffFormat::Ed && !opts.brief && (opts.text || !has_nul) {
        for (p, b) in [(path_a, bytes_a), (path_b, bytes_b)] {
            if !b.is_empty() && !b.ends_with(b"\n") {
                stderr.push_str(&format!("diff: {p}: No newline at end of file\n\n"));
                trouble = true;
                incomplete_ed = true;
            }
        }
    }
    if !opts.text
        && bytes_a == bytes_b
        && (format != DiffFormat::SideBySide && format != DiffFormat::Ifdef || bytes_a.contains(&0))
    {
        let mut out = String::new();
        if opts.report_identical && !incomplete_ed {
            out.push_str(&format!("Files {label_a} and {label_b} are identical\n"));
        }
        return (out, false, trouble);
    }
    if !opts.text && has_nul {
        let msg = format!(
            "{} {label_a} and {label_b} differ\n",
            if opts.brief { "Files" } else { "Binary files" }
        );
        return (msg, true, trouble);
    }
    let (text_a, text_b) = match (std::str::from_utf8(bytes_a), std::str::from_utf8(bytes_b)) {
        (Ok(sa), Ok(sb)) => (sa.to_string(), sb.to_string()),
        _ => (
            crate::vfs::bytes_to_stream_string(bytes_a),
            crate::vfs::bytes_to_stream_string(bytes_b),
        ),
    };
    let (mut d_out, differed) = diff_two_texts(label_a, label_b, &text_a, &text_b, opts);
    if incomplete_ed && !differed && opts.report_identical {
        d_out.clear();
    }
    if nested && !opts.brief && (differed || format == DiffFormat::SideBySide) {
        let mut hdr = String::from("diff");
        for oa in &opts.option_args {
            hdr.push(' ');
            hdr.push_str(&quote_diff_arg(oa));
        }
        hdr.push(' ');
        hdr.push_str(&quote_diff_arg(label_a));
        hdr.push(' ');
        hdr.push_str(&quote_diff_arg(label_b));
        hdr.push('\n');
        d_out.insert_str(0, &hdr);
    }
    (d_out, differed, trouble)
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
    stderr: &mut String,
    any_diff: &mut bool,
    any_trouble: &mut bool,
) {
    let new_file = opts.new_file;
    let unidir_new_file = opts.unidir_new_file;
    let mut map: BTreeMap<String, (Option<String>, Option<String>)> = BTreeMap::new();
    for n in fs.list_dir(full_a).unwrap_or_default() {
        let key = if opts.ignore_file_name_case {
            n.to_ascii_lowercase()
        } else {
            n.clone()
        };
        let entry = map.entry(key).or_insert((None, None));
        if entry.0.is_none() {
            entry.0 = Some(n);
        }
    }
    for n in fs.list_dir(full_b).unwrap_or_default() {
        let key = if opts.ignore_file_name_case {
            n.to_ascii_lowercase()
        } else {
            n.clone()
        };
        let entry = map.entry(key).or_insert((None, None));
        if entry.1.is_none() {
            entry.1 = Some(n);
        }
    }
    for (_key, (left_opt, right_opt)) in map {
        let name_a = left_opt.as_deref().or(right_opt.as_deref()).unwrap_or("");
        let name_b = right_opt.as_deref().or(left_opt.as_deref()).unwrap_or("");
        if let Some(ref sf) = opts.starting_file {
            let cmp_ok = if opts.ignore_file_name_case {
                name_a.to_ascii_lowercase() >= sf.to_ascii_lowercase()
            } else {
                name_a >= sf.as_str()
            };
            if !cmp_ok {
                continue;
            }
        }
        if opts
            .excludes
            .iter()
            .any(|p| diff_glob_matches(p, name_a) || diff_glob_matches(p, name_b))
        {
            continue;
        }
        let ca = if full_a == "/" {
            format!("/{name_a}")
        } else {
            format!("{full_a}/{name_a}")
        };
        let cb = if full_b == "/" {
            format!("/{name_b}")
        } else {
            format!("{full_b}/{name_b}")
        };
        let da = format!("{}/{name_a}", disp_a.trim_end_matches('/'));
        let db = format!("{}/{name_b}", disp_b.trim_end_matches('/'));
        let sym_a = fs.readlink(&ca).ok();
        let sym_b = fs.readlink(&cb).ok();
        if opts.no_deref && (sym_a.is_some() || sym_b.is_some()) {
            if sym_a != sym_b {
                *any_diff = true;
                out.push_str(&format!("Symbolic links {da} and {db} differ\n"));
            }
            continue;
        }
        let ex_a = left_opt.is_some() && (fs.exists(&ca) || sym_a.is_some());
        let ex_b = right_opt.is_some() && (fs.exists(&cb) || sym_b.is_some());
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
                out.push_str(&format!("Only in {}: {name_a}\n", disp_a.trim_end_matches('/')));
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
                out.push_str(&format!("Only in {}: {name_b}\n", disp_b.trim_end_matches('/')));
            }
        } else if fs.is_dir(&ca) != fs.is_dir(&cb) {
            *any_diff = true;
            let type_desc = |p: &str| -> &'static str {
                if fs.is_dir(p) {
                    "directory"
                } else if fs.read_file(p).map(|b| b.is_empty()).unwrap_or(false) {
                    "regular empty file"
                } else {
                    "regular file"
                }
            };
            out.push_str(&format!(
                "File {da} is a {} while file {db} is a {}\n",
                type_desc(&ca),
                type_desc(&cb)
            ));
        } else if fs.is_dir(&ca) && fs.is_dir(&cb) {
            if opts.recursive {
                let mut child_opts = opts.clone();
                child_opts.starting_file = None;
                diff_dirs_recursive(
                    &da,
                    &db,
                    &ca,
                    &cb,
                    &child_opts,
                    fs,
                    out,
                    stderr,
                    any_diff,
                    any_trouble,
                );
            } else {
                out.push_str(&format!("Common subdirectories: {da} and {db}\n"));
            }
        } else {
            let ba = fs.read_file(&ca).unwrap_or_default();
            let bb = fs.read_file(&cb).unwrap_or_default();
            let la = opts.labels.first().map(|s| s.as_str()).unwrap_or(&da);
            let lb = opts.labels.get(1).map(|s| s.as_str()).unwrap_or(&db);
            let (d_out, differed, tr) =
                diff_two_byte_inputs(&da, &db, la, lb, &ba, &bb, true, opts, stderr);
            if differed {
                *any_diff = true;
            }
            if tr {
                *any_trouble = true;
            }
            out.push_str(&d_out);
        }
    }
}

fn cmd_diff(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut opts = DiffOpts {
        width: 130,
        ..Default::default()
    };
    let mut from_file: Option<String> = None;
    let mut to_file: Option<String> = None;
    let mut files = Vec::new();
    let mut exclude_files = Vec::new();
    let mut selected_format: Option<DiffFormat> = None;
    let mut explicit_ctx_width: Option<usize> = None;
    let mut legacy_context: Option<usize> = None;
    let mut operands_only = false;

    let select_format =
        |fmt: DiffFormat, sel: &mut Option<DiffFormat>, o: &mut DiffOpts| -> Result<(), String> {
            if let Some(prev) = *sel
                && prev != fmt
            {
                return Err("diff: conflicting output format options\n".to_string());
            }
            *sel = Some(fmt);
            o.format = Some(fmt);
            Ok(())
        };

    let parse_ctx_len = |val: &str| -> Result<usize, String> {
        let trimmed = val.trim();
        if trimmed.is_empty() {
            return Ok(3);
        }
        match trimmed.parse::<isize>() {
            Ok(n) if n >= 0 => Ok(n as usize),
            _ => Err(format!("diff: invalid context length '{val}'\n")),
        }
    };

    let parse_width = |val: &str| -> Result<usize, String> {
        let trimmed = val.trim();
        match trimmed.parse::<usize>() {
            Ok(n) if n > 0 => Ok(n),
            _ => Err(format!("diff: invalid width '{val}'\n")),
        }
    };

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !operands_only && a == "--" {
            operands_only = true;
            i += 1;
            continue;
        }
        if operands_only || a == "-" || !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
            continue;
        }
        let opt_start = i;
        match a.as_str() {
            "--normal" => {
                if let Err(e) = select_format(DiffFormat::Normal, &mut selected_format, &mut opts) {
                    return err_out(&e, 2);
                }
            }
            "-u" | "--unified" => {
                if let Err(e) = select_format(DiffFormat::Unified, &mut selected_format, &mut opts) {
                    return err_out(&e, 2);
                }
                opts.ctx_lines = Some(explicit_ctx_width.unwrap_or(3));
            }
            "-c" | "--context" => {
                if let Err(e) = select_format(DiffFormat::Context, &mut selected_format, &mut opts) {
                    return err_out(&e, 2);
                }
                opts.ctx_lines = Some(explicit_ctx_width.unwrap_or(3));
            }
            "-e" | "--ed" => {
                if let Err(e) = select_format(DiffFormat::Ed, &mut selected_format, &mut opts) {
                    return err_out(&e, 2);
                }
            }
            "-n" | "--rcs" => {
                if let Err(e) = select_format(DiffFormat::Rcs, &mut selected_format, &mut opts) {
                    return err_out(&e, 2);
                }
            }
            "-y" | "--side-by-side" => {
                if let Err(e) = select_format(DiffFormat::SideBySide, &mut selected_format, &mut opts) {
                    return err_out(&e, 2);
                }
            }
            "--left-column" => opts.left_column = true,
            "--suppress-common-lines" => opts.suppress_common = true,
            "--no-dereference" => opts.no_deref = true,
            "--strip-trailing-cr" => opts.strip_trailing_cr = true,
            "-a" | "--text" => opts.text = true,
            "--ignore-file-name-case" => opts.ignore_file_name_case = true,
            "--no-ignore-file-name-case" => opts.ignore_file_name_case = false,
            "-d" | "--minimal" | "-l" | "--paginate" | "--color" | "--color=always" | "--color=auto" | "--color=never" => {}
            other if other.starts_with("--color=") => {
                return err_out(&format!("diff: invalid color mode in {other}\n"), 2);
            }
            "--help" | "-v" | "--version" => {
                return ok_out("diff (GNU diffutils) 3.10\n");
            }
            "-p" | "--show-c-function" => {
                opts.show_c_func = true;
                opts.show_func_regexes.push("^[A-Za-z_$]".to_string());
            }
            "-N" | "--new-file" => opts.new_file = true,
            "-P" | "--unidirectional-new-file" => opts.unidir_new_file = true,
            "-q" | "--brief" => opts.brief = true,
            "-s" | "--report-identical-files" => opts.report_identical = true,
            "-i" | "--ignore-case" => opts.ignore_case = true,
            "-w" | "--ignore-all-space" => opts.ignore_all_space = true,
            "-b" | "--ignore-space-change" => opts.ignore_space_change = true,
            "-E" | "--ignore-tab-expansion" => opts.ignore_tab_expansion = true,
            "-Z" | "--ignore-trailing-space" => opts.ignore_trailing_space = true,
            "-t" | "--expand-tabs" => opts.expand_tabs = true,
            "-T" | "--initial-tab" => opts.initial_tab = true,
            "-B" | "--ignore-blank-lines" => opts.ignore_blank_lines = true,
            "-r" | "--recursive" => opts.recursive = true,
            "-U" => {
                if i + 1 >= args.len() {
                    return err_out("diff: option requires an argument -- 'U'\n", 2);
                }
                if let Err(e) = select_format(DiffFormat::Unified, &mut selected_format, &mut opts) {
                    return err_out(&e, 2);
                }
                i += 1;
                let w = match parse_ctx_len(&args[i]) {
                    Ok(v) => v,
                    Err(e) => return err_out(&e, 2),
                };
                if let Some(prev) = explicit_ctx_width
                    && prev != w
                {
                    return err_out("diff: conflicting output style options\n", 2);
                }
                explicit_ctx_width = Some(w);
                opts.ctx_lines = Some(w);
            }
            "-C" => {
                if i + 1 >= args.len() {
                    return err_out("diff: option requires an argument -- 'C'\n", 2);
                }
                if let Err(e) = select_format(DiffFormat::Context, &mut selected_format, &mut opts) {
                    return err_out(&e, 2);
                }
                i += 1;
                let w = match parse_ctx_len(&args[i]) {
                    Ok(v) => v,
                    Err(e) => return err_out(&e, 2),
                };
                if let Some(prev) = explicit_ctx_width
                    && prev != w
                {
                    return err_out("diff: conflicting output style options\n", 2);
                }
                explicit_ctx_width = Some(w);
                opts.ctx_lines = Some(w);
            }
            "-W" | "--width" => {
                if i + 1 >= args.len() {
                    return err_out("diff: option requires an argument -- 'W'\n", 2);
                }
                i += 1;
                opts.width = match parse_width(&args[i]) {
                    Ok(v) => v,
                    Err(e) => return err_out(&e, 2),
                };
            }
            "-F" | "--show-function-line" => {
                if i + 1 >= args.len() {
                    return err_out("diff: option requires an argument -- 'F'\n", 2);
                }
                i += 1;
                opts.show_func_regexes.push(args[i].clone());
            }
            "-S" | "--starting-file" => {
                if i + 1 >= args.len() {
                    return err_out("diff: option requires an argument -- 'S'\n", 2);
                }
                i += 1;
                opts.starting_file = Some(args[i].clone());
            }
            "-X" | "--exclude-from" => {
                if i + 1 >= args.len() {
                    return err_out("diff: option requires an argument -- 'X'\n", 2);
                }
                i += 1;
                exclude_files.push(args[i].clone());
            }
            "-D" | "--ifdef" => {
                if i + 1 >= args.len() {
                    return err_out("diff: option requires an argument -- 'D'\n", 2);
                }
                if let Err(e) = select_format(DiffFormat::Ifdef, &mut selected_format, &mut opts) {
                    return err_out(&e, 2);
                }
                i += 1;
                opts.ifdef_macro = args[i].clone();
            }
            "-L" | "--label" => {
                if i + 1 >= args.len() {
                    return err_out("diff: option requires an argument -- 'L'\n", 2);
                }
                i += 1;
                opts.labels.push(args[i].clone());
            }
            "-I" | "--ignore-matching-lines" => {
                if i + 1 >= args.len() {
                    return err_out("diff: option requires an argument -- 'I'\n", 2);
                }
                i += 1;
                opts.ignore_regexes.push(args[i].clone());
            }
            "-x" | "--exclude" => {
                if i + 1 >= args.len() {
                    return err_out("diff: option requires an argument -- 'x'\n", 2);
                }
                i += 1;
                opts.excludes.push(args[i].clone());
            }
            "--from-file" => {
                if i + 1 >= args.len() {
                    return err_out("diff: option '--from-file' requires an argument\n", 2);
                }
                i += 1;
                from_file = Some(args[i].clone());
            }
            "--to-file" => {
                if i + 1 >= args.len() {
                    return err_out("diff: option '--to-file' requires an argument\n", 2);
                }
                i += 1;
                to_file = Some(args[i].clone());
            }
            _ if a.starts_with("--label=") => {
                opts.labels.push(a["--label=".len()..].to_string());
            }
            _ if a.starts_with("--ignore-matching-lines=") => {
                opts.ignore_regexes
                    .push(a["--ignore-matching-lines=".len()..].to_string());
            }
            _ if a.starts_with("--show-function-line=") => {
                opts.show_func_regexes
                    .push(a["--show-function-line=".len()..].to_string());
            }
            _ if a.starts_with("--width=") => {
                opts.width = match parse_width(&a["--width=".len()..]) {
                    Ok(v) => v,
                    Err(e) => return err_out(&e, 2),
                };
            }
            _ if a.starts_with("--ifdef=") => {
                if let Err(e) = select_format(DiffFormat::Ifdef, &mut selected_format, &mut opts) {
                    return err_out(&e, 2);
                }
                opts.ifdef_macro = a["--ifdef=".len()..].to_string();
            }
            _ if a.starts_with("--exclude=") => {
                opts.excludes.push(a["--exclude=".len()..].to_string());
            }
            _ if a.starts_with("--exclude-from=") => {
                exclude_files.push(a["--exclude-from=".len()..].to_string());
            }
            _ if a.starts_with("--starting-file=") => {
                opts.starting_file = Some(a["--starting-file=".len()..].to_string());
            }
            _ if a.starts_with("--from-file=") => {
                from_file = Some(a["--from-file=".len()..].to_string());
            }
            _ if a.starts_with("--to-file=") => {
                to_file = Some(a["--to-file=".len()..].to_string());
            }
            _ if a.starts_with("--unified=") => {
                if let Err(e) = select_format(DiffFormat::Unified, &mut selected_format, &mut opts) {
                    return err_out(&e, 2);
                }
                let w = match parse_ctx_len(&a["--unified=".len()..]) {
                    Ok(v) => v,
                    Err(e) => return err_out(&e, 2),
                };
                if let Some(prev) = explicit_ctx_width
                    && prev != w
                {
                    return err_out("diff: conflicting output style options\n", 2);
                }
                explicit_ctx_width = Some(w);
                opts.ctx_lines = Some(w);
            }
            _ if a.starts_with("--context=") => {
                if let Err(e) = select_format(DiffFormat::Context, &mut selected_format, &mut opts) {
                    return err_out(&e, 2);
                }
                let w = match parse_ctx_len(&a["--context=".len()..]) {
                    Ok(v) => v,
                    Err(e) => return err_out(&e, 2),
                };
                if let Some(prev) = explicit_ctx_width
                    && prev != w
                {
                    return err_out("diff: conflicting output style options\n", 2);
                }
                explicit_ctx_width = Some(w);
                opts.ctx_lines = Some(w);
            }
            _ if a.starts_with("--") => {
                return err_out(&format!("diff: unrecognized option '{a}'\n"), 2);
            }
            _ if a.starts_with('-') && a != "-" => {
                let mut prev_digit = false;
                for (byte_off, ch) in a[1..].char_indices() {
                    if ch.is_ascii_digit() {
                        let d = (ch as u8 - b'0') as usize;
                        legacy_context = Some(if prev_digit {
                            legacy_context.unwrap_or(0).saturating_mul(10).saturating_add(d)
                        } else {
                            d
                        });
                        prev_digit = true;
                        continue;
                    }
                    prev_digit = false;
                    match ch {
                        'u' => {
                            if let Err(e) = select_format(DiffFormat::Unified, &mut selected_format, &mut opts) {
                                return err_out(&e, 2);
                            }
                            opts.ctx_lines = Some(explicit_ctx_width.unwrap_or(3));
                        }
                        'c' => {
                            if let Err(e) = select_format(DiffFormat::Context, &mut selected_format, &mut opts) {
                                return err_out(&e, 2);
                            }
                            opts.ctx_lines = Some(explicit_ctx_width.unwrap_or(3));
                        }
                        'e' => {
                            if let Err(e) = select_format(DiffFormat::Ed, &mut selected_format, &mut opts) {
                                return err_out(&e, 2);
                            }
                        }
                        'n' => {
                            if let Err(e) = select_format(DiffFormat::Rcs, &mut selected_format, &mut opts) {
                                return err_out(&e, 2);
                            }
                        }
                        'y' => {
                            if let Err(e) = select_format(DiffFormat::SideBySide, &mut selected_format, &mut opts) {
                                return err_out(&e, 2);
                            }
                        }
                        'a' => opts.text = true,
                        'd' | 'l' => {}
                        'N' => opts.new_file = true,
                        'P' => opts.unidir_new_file = true,
                        'r' => opts.recursive = true,
                        'q' => opts.brief = true,
                        's' => opts.report_identical = true,
                        'i' => opts.ignore_case = true,
                        'w' => opts.ignore_all_space = true,
                        'b' => opts.ignore_space_change = true,
                        'E' => opts.ignore_tab_expansion = true,
                        'Z' => opts.ignore_trailing_space = true,
                        't' => opts.expand_tabs = true,
                        'T' => opts.initial_tab = true,
                        'B' => opts.ignore_blank_lines = true,
                        'p' => {
                            opts.show_c_func = true;
                            opts.show_func_regexes.push("^[A-Za-z_$]".to_string());
                        }
                        'U' | 'C' | 'L' | 'W' | 'D' | 'I' | 'F' | 'x' | 'X' | 'S' => {
                            let rest = &a[1 + byte_off + ch.len_utf8()..];
                            let param = if !rest.is_empty() {
                                rest.to_string()
                            } else if i + 1 < args.len() {
                                i += 1;
                                args[i].clone()
                            } else {
                                return err_out(&format!("diff: option requires an argument -- '{ch}'\n"), 2);
                            };
                            match ch {
                                'U' => {
                                    if let Err(e) = select_format(DiffFormat::Unified, &mut selected_format, &mut opts) {
                                        return err_out(&e, 2);
                                    }
                                    let w = match parse_ctx_len(&param) {
                                        Ok(v) => v,
                                        Err(e) => return err_out(&e, 2),
                                    };
                                    if let Some(prev) = explicit_ctx_width
                                        && prev != w
                                    {
                                        return err_out("diff: conflicting output style options\n", 2);
                                    }
                                    explicit_ctx_width = Some(w);
                                    opts.ctx_lines = Some(w);
                                }
                                'C' => {
                                    if let Err(e) = select_format(DiffFormat::Context, &mut selected_format, &mut opts) {
                                        return err_out(&e, 2);
                                    }
                                    let w = match parse_ctx_len(&param) {
                                        Ok(v) => v,
                                        Err(e) => return err_out(&e, 2),
                                    };
                                    if let Some(prev) = explicit_ctx_width
                                        && prev != w
                                    {
                                        return err_out("diff: conflicting output style options\n", 2);
                                    }
                                    explicit_ctx_width = Some(w);
                                    opts.ctx_lines = Some(w);
                                }
                                'L' => opts.labels.push(param),
                                'W' => {
                                    opts.width = match parse_width(&param) {
                                        Ok(v) => v,
                                        Err(e) => return err_out(&e, 2),
                                    };
                                }
                                'D' => {
                                    if let Err(e) = select_format(DiffFormat::Ifdef, &mut selected_format, &mut opts) {
                                        return err_out(&e, 2);
                                    }
                                    opts.ifdef_macro = param;
                                }
                                'I' => opts.ignore_regexes.push(param),
                                'F' => opts.show_func_regexes.push(param),
                                'x' => opts.excludes.push(param),
                                'X' => exclude_files.push(param),
                                'S' => opts.starting_file = Some(param),
                                _ => {}
                            }
                            break;
                        }
                        other => {
                            return err_out(&format!("diff: invalid option -- '{other}'\n"), 2);
                        }
                    }
                }
            }
            _ => files.push(a.clone()),
        }
        opts.option_args.extend_from_slice(&args[opt_start..=i]);
        i += 1;
    }

    if let Some(lc) = legacy_context
        && matches!(opts.format, Some(DiffFormat::Unified | DiffFormat::Context))
    {
        opts.ctx_lines = Some(explicit_ctx_width.map_or(lc, |ew| ew.max(lc)));
    }
    if opts.labels.len() > 2 {
        return err_out("diff: at most two labels are supported\n", 2);
    }
    if from_file.is_some() && to_file.is_some() {
        return err_out("diff: --from-file and --to-file may not both be specified\n", 2);
    }

    for exf in exclude_files {
        let full = resolve_posix_path(cwd, &exf);
        if let Ok(bytes) = fs.read_file(&full) {
            let txt = String::from_utf8_lossy(&bytes);
            for line in txt.lines() {
                if !line.is_empty() {
                    opts.excludes.push(line.to_string());
                }
            }
        }
    }

    if from_file.is_some() || to_file.is_some() {
        if files.is_empty() {
            return err_out("diff: missing operand\n", 2);
        }
        let mut pairs = Vec::new();
        if let Some(ref ff) = from_file {
            for f in &files {
                pairs.push((ff.clone(), f.clone()));
            }
        } else if let Some(ref tf) = to_file {
            for f in &files {
                pairs.push((f.clone(), tf.clone()));
            }
        }
        let mut total_out = String::new();
        let mut total_err = String::new();
        let mut any_diff = false;
        let mut any_trouble = false;
        for (fa, fb) in pairs {
            let ba = if fa == "-" {
                crate::vfs::stream_string_to_bytes(stdin)
            } else {
                match fs.read_file(&resolve_posix_path(cwd, &fa)) {
                    Ok(b) => b,
                    Err(_) => {
                        total_err.push_str(&format!("diff: {fa}: No such file or directory\n"));
                        any_trouble = true;
                        continue;
                    }
                }
            };
            let bb = if fb == "-" {
                crate::vfs::stream_string_to_bytes(stdin)
            } else {
                match fs.read_file(&resolve_posix_path(cwd, &fb)) {
                    Ok(b) => b,
                    Err(_) => {
                        total_err.push_str(&format!("diff: {fb}: No such file or directory\n"));
                        any_trouble = true;
                        continue;
                    }
                }
            };
            let la = opts.labels.first().unwrap_or(&fa);
            let lb = opts.labels.get(1).unwrap_or(&fb);
            let (o, d, tr) =
                diff_two_byte_inputs(&fa, &fb, la, lb, &ba, &bb, false, &opts, &mut total_err);
            if d {
                any_diff = true;
            }
            if tr {
                any_trouble = true;
            }
            total_out.push_str(&o);
        }
        return BuiltinOutcome {
            stdout: total_out,
            stderr: total_err,
            exit_code: if any_trouble { 2 } else if any_diff { 1 } else { 0 },
        };
    }

    if files.len() < 2 {
        return err_out("diff: missing operand\n", 2);
    }
    if files.len() > 2 {
        return err_out(&format!("diff: extra operand '{}'\n", files[2]), 2);
    }

    let mut full_a = resolve_posix_path(cwd, &files[0]);
    let mut full_b = resolve_posix_path(cwd, &files[1]);
    if files[0] != "-" && files[1] != "-" {
        if fs.is_dir(&full_a) && fs.is_dir(&full_b) {
            let mut out = String::new();
            let mut stderr = String::new();
            let mut any_diff = false;
            let mut any_trouble = false;
            diff_dirs_recursive(
                &files[0],
                &files[1],
                &full_a,
                &full_b,
                &opts,
                fs,
                &mut out,
                &mut stderr,
                &mut any_diff,
                &mut any_trouble,
            );
            return BuiltinOutcome {
                stdout: out,
                stderr,
                exit_code: if any_trouble { 2 } else if any_diff { 1 } else { 0 },
            };
        } else if !fs.is_dir(&full_a) && fs.is_dir(&full_b) {
            let base = files[0].rsplit('/').next().unwrap_or(&files[0]).to_string();
            files[1] = format!("{}/{base}", files[1].trim_end_matches('/'));
            full_b = resolve_posix_path(cwd, &files[1]);
        } else if fs.is_dir(&full_a) && !fs.is_dir(&full_b) {
            let base = files[1].rsplit('/').next().unwrap_or(&files[1]).to_string();
            files[0] = format!("{}/{base}", files[0].trim_end_matches('/'));
            full_a = resolve_posix_path(cwd, &files[0]);
        }
    }
    let _ = (full_a, full_b);

    let read_side_bytes = |name: &str| -> Result<Vec<u8>, String> {
        if name == "-" {
            return Ok(crate::vfs::stream_string_to_bytes(stdin));
        }
        let full = resolve_posix_path(cwd, name);
        fs.read_file(&full)
            .map_err(|_| format!("diff: {name}: No such file or directory\n"))
    };

    let bytes_a = match read_side_bytes(&files[0]) {
        Ok(t) => t,
        Err(e) => return err_out(&e, 2),
    };
    let bytes_b = match read_side_bytes(&files[1]) {
        Ok(t) => t,
        Err(e) => return err_out(&e, 2),
    };

    let mut stderr = String::new();
    let (out, differed, trouble) = diff_two_byte_inputs(
        &files[0],
        &files[1],
        opts.labels.first().unwrap_or(&files[0]),
        opts.labels.get(1).unwrap_or(&files[1]),
        &bytes_a,
        &bytes_b,
        false,
        &opts,
        &mut stderr,
    );

    BuiltinOutcome {
        stdout: out,
        stderr,
        exit_code: if trouble { 2 } else if differed { 1 } else { 0 },
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
    strip: Option<usize>,
    reverse: bool,
    dry_run: bool,
    always_backup: bool,
    backup_if_mismatch: bool,
    posix: bool,
    reject_format: Option<String>,
    was_context_diff: bool,
    backup_suffix: String,
    backup_prefix: Option<String>,
    backup_basename_prefix: Option<String>,
    version_control: Option<String>,
    remove_empty: bool,
    ignore_ws: bool,
    fuzz: usize,
    forward_only: bool,
    force: bool,
    merge_mode: bool,
    merge_diff3: bool,
    atomic: bool,
    ifdef_guard: Option<String>,
    work_cwd: String,
}

fn decode_patch_header_path(raw_line: &str) -> (String, bool) {
    let is_epoch = raw_line.split_once('\t').is_some_and(|(_, ts)| {
        let t = ts.trim();
        t.starts_with("1970-01-01 00:00:00") || t.starts_with("1969-12-31 ")
    });
    let trimmed = raw_line.trim_start();
    if let Some(rest) = trimmed.strip_prefix('"') {
        let mut bytes = Vec::new();
        let chars: Vec<char> = rest.chars().collect();
        let mut idx = 0usize;
        while idx < chars.len() {
            let ch = chars[idx];
            idx += 1;
            if ch == '"' {
                break;
            }
            if ch == '\\' && idx < chars.len() {
                let esc = chars[idx];
                idx += 1;
                if ('0'..='7').contains(&esc) && idx + 1 < chars.len() && ('0'..='7').contains(&chars[idx]) && ('0'..='7').contains(&chars[idx + 1]) {
                    let oct_s: String = [esc, chars[idx], chars[idx + 1]].iter().collect();
                    idx += 2;
                    if let Ok(b) = u8::from_str_radix(&oct_s, 8) {
                        bytes.push(b);
                        continue;
                    }
                }
                match esc {
                    'a' => bytes.push(7),
                    'b' => bytes.push(8),
                    't' => bytes.push(9),
                    'n' => bytes.push(10),
                    'v' => bytes.push(11),
                    'f' => bytes.push(12),
                    'r' => bytes.push(13),
                    '"' => bytes.push(b'"'),
                    '\\' => bytes.push(b'\\'),
                    other => {
                        let mut buf = [0u8; 4];
                        bytes.extend_from_slice(other.encode_utf8(&mut buf).as_bytes());
                    }
                }
            } else {
                let mut buf = [0u8; 4];
                bytes.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
            }
        }
        return (String::from_utf8_lossy(&bytes).into_owned(), is_epoch);
    }
    if let Some((before_tab, _)) = trimmed.split_once('\t') {
        return (before_tab.trim_end().to_string(), is_epoch);
    }
    (trimmed.split_whitespace().next().unwrap_or("").to_string(), is_epoch)
}

fn context_range_to_unified(r: &str) -> String {
    let r = r.trim();
    if let Some((s_str, e_str)) = r.split_once(',')
        && let (Ok(s), Ok(e)) = (s_str.trim().parse::<usize>(), e_str.trim().parse::<usize>())
    {
        let count = if s == 0 { 0 } else { e.saturating_sub(s) + 1 };
        format!("{s},{count}")
    } else if let Ok(s) = r.parse::<usize>() {
        let count = if s == 0 { 0 } else { 1 };
        format!("{s},{count}")
    } else {
        r.to_string()
    }
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
        if lines[i].starts_with("***************") {
            i += 1;
            if i < lines.len() && lines[i].starts_with("*** ") && lines[i].ends_with("****") {
                let a_range_raw = lines[i]
                    .trim_start_matches('*')
                    .trim_end_matches('*')
                    .trim();
                let a_range = context_range_to_unified(a_range_raw);
                i += 1;
                let mut old_part = Vec::new();
                while i < lines.len()
                    && !(lines[i].starts_with("--- ") && lines[i].ends_with("----"))
                    && !lines[i].starts_with("***************")
                {
                    old_part.push(lines[i]);
                    i += 1;
                }
                let mut b_range = a_range.clone();
                let mut new_part = Vec::new();
                if i < lines.len() && lines[i].starts_with("--- ") && lines[i].ends_with("----") {
                    let b_range_raw = lines[i]
                        .trim_start_matches('-')
                        .trim_end_matches('-')
                        .trim();
                    b_range = context_range_to_unified(b_range_raw);
                    i += 1;
                    while i < lines.len()
                        && !lines[i].starts_with("***************")
                        && !lines[i].starts_with("*** ")
                    {
                        new_part.push(lines[i]);
                        i += 1;
                    }
                }
                if old_part.is_empty() {
                    old_part = new_part
                        .iter()
                        .copied()
                        .filter(|l| l.starts_with("  "))
                        .collect();
                } else if new_part.is_empty() {
                    new_part = old_part
                        .iter()
                        .copied()
                        .filter(|l| l.starts_with("  "))
                        .collect();
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
        backup_if_mismatch: true,
        fuzz: 2,
        backup_suffix: ".orig".to_string(),
        work_cwd: cwd.to_string(),
        ..Default::default()
    };
    let mut backup_explicit = false;
    let mut fuzz_explicit = false;
    let mut silent = false;
    let mut input_file: Option<String> = None;
    let mut output_file: Option<String> = None;
    let mut reject_file: Option<String> = None;
    let mut target_file: Option<String> = None;

    let mut i = 0usize;
    let mut literal = false;
    while i < args.len() {
        let a = &args[i];
        if literal {
            if target_file.is_none() {
                target_file = Some(a.clone());
            } else if input_file.is_none() {
                input_file = Some(a.clone());
            }
            i += 1;
            continue;
        }
        if a == "--" {
            literal = true;
            i += 1;
            continue;
        }
        if a == "-R" || a == "--reverse" {
            opts.reverse = true;
        } else if a == "-s" || a == "--silent" || a == "--quiet" {
            silent = true;
        } else if a == "--dry-run" {
            opts.dry_run = true;
        } else if a == "-b" || a == "--backup" {
            opts.always_backup = true;
        } else if a == "--backup-if-mismatch" {
            opts.backup_if_mismatch = true;
            backup_explicit = true;
        } else if a == "--no-backup-if-mismatch" {
            opts.backup_if_mismatch = false;
            backup_explicit = true;
        } else if a == "--posix" {
            opts.posix = true;
        } else if a == "-E" || a == "--remove-empty-files" {
            opts.remove_empty = true;
        } else if a == "-l" || a == "--ignore-whitespace" || a == "--ignore-white-space" {
            opts.ignore_ws = true;
        } else if a == "-N" || a == "--forward" {
            opts.forward_only = true;
        } else if a == "-f" || a == "--force" || a == "-t" || a == "--batch" {
            opts.force = true;
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
        } else if let Some(m) = a.strip_prefix("-D") {
            opts.ifdef_guard = Some(m.to_string());
        } else if (a == "-d" || a == "--directory") && i + 1 < args.len() {
            i += 1;
            opts.work_cwd = resolve_posix_path(cwd, &args[i]);
        } else if let Some(dir) = a.strip_prefix("--directory=") {
            opts.work_cwd = resolve_posix_path(cwd, dir);
        } else if (a == "-z" || a == "--suffix") && i + 1 < args.len() {
            i += 1;
            opts.backup_suffix = args[i].clone();
        } else if let Some(s) = a.strip_prefix("--suffix=") {
            opts.backup_suffix = s.to_string();
        } else if (a == "-B" || a == "--prefix") && i + 1 < args.len() {
            i += 1;
            opts.backup_prefix = Some(args[i].clone());
        } else if let Some(p) = a.strip_prefix("--prefix=") {
            opts.backup_prefix = Some(p.to_string());
        } else if (a == "-Y" || a == "--basename-prefix") && i + 1 < args.len() {
            i += 1;
            opts.backup_basename_prefix = Some(args[i].clone());
        } else if let Some(p) = a.strip_prefix("--basename-prefix=") {
            opts.backup_basename_prefix = Some(p.to_string());
        } else if (a == "-V" || a == "--version-control") && i + 1 < args.len() {
            i += 1;
            opts.version_control = Some(args[i].clone());
        } else if let Some(vc) = a.strip_prefix("--version-control=") {
            opts.version_control = Some(vc.to_string());
        } else if (a == "-F" || a == "--fuzz") && i + 1 < args.len() {
            i += 1;
            opts.fuzz = args[i].parse().unwrap_or(0);
            fuzz_explicit = true;
        } else if let Some(f) = a.strip_prefix("--fuzz=") {
            opts.fuzz = f.parse().unwrap_or(0);
            fuzz_explicit = true;
        } else if let Some(f) = a.strip_prefix("-F") {
            opts.fuzz = f.parse().unwrap_or(0);
            fuzz_explicit = true;
        } else if let Some(rf) = a.strip_prefix("--reject-format=") {
            opts.reject_format = Some(rf.to_string());
        } else if a == "--reject-format" && i + 1 < args.len() {
            i += 1;
            opts.reject_format = Some(args[i].clone());
        } else if let Some(p) = a.strip_prefix("-p") {
            if !p.is_empty() {
                opts.strip = Some(p.parse().unwrap_or(0));
            } else if i + 1 < args.len() {
                i += 1;
                opts.strip = Some(args[i].parse().unwrap_or(0));
            }
        } else if let Some(p) = a.strip_prefix("--strip=") {
            opts.strip = Some(p.parse().unwrap_or(0));
        } else if a == "-i" && i + 1 < args.len() {
            i += 1;
            input_file = Some(args[i].clone());
        } else if let Some(inf) = a.strip_prefix("--input=") {
            input_file = Some(inf.to_string());
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

    if opts.posix && !backup_explicit {
        opts.backup_if_mismatch = false;
    }
    if opts.merge_mode && !fuzz_explicit {
        opts.fuzz = 0;
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
    opts.was_context_diff = patch_text.contains("***************");
    let normalized_patch = convert_context_diff_to_unified(&patch_text);

    let mut stdout_patched = String::new();
    match apply_unified_diff(
        &normalized_patch,
        target_file.as_deref(),
        output_file.as_deref(),
        reject_file.as_deref(),
        &opts,
        fs,
        &mut stdout_patched,
    ) {
        Ok((status_msg, had_failure)) => {
            if output_file.as_deref() == Some("-") {
                BuiltinOutcome {
                    stdout: stdout_patched,
                    stderr: if silent { String::new() } else { status_msg },
                    exit_code: if had_failure { 1 } else { 0 },
                }
            } else {
                BuiltinOutcome {
                    stdout: if silent { String::new() } else { status_msg },
                    stderr: String::new(),
                    exit_code: if had_failure { 1 } else { 0 },
                }
            }
        }
        Err(e) => err_out(&format!("patch: {e}\n"), 1),
    }
}

fn compute_backup_path(orig_full: &str, opts: &PatchOpts, fs: &dyn SafeBashFs) -> String {
    let cwd = &opts.work_cwd;
    if opts.backup_prefix.is_some() || opts.backup_basename_prefix.is_some() {
        let cwd_prefix = format!("{}/", cwd.trim_end_matches('/'));
        let rel = orig_full.strip_prefix(&cwd_prefix).unwrap_or(orig_full);
        let prefixed = if let Some(ref pre) = opts.backup_prefix {
            format!("{pre}{rel}")
        } else {
            let dir = crate::vfs::dirname_posix_path(orig_full);
            let base = orig_full.rsplit('/').next().unwrap_or(orig_full);
            let bp = opts.backup_basename_prefix.as_deref().unwrap_or("");
            if dir == "/" {
                format!("/{bp}{base}")
            } else {
                format!("{dir}/{bp}{base}")
            }
        };
        return resolve_posix_path(cwd, &format!("{prefixed}{}", opts.backup_suffix));
    }
    let vc = opts.version_control.as_deref().unwrap_or("simple");
    if vc == "numbered" || vc == "existing" {
        let parent = crate::vfs::dirname_posix_path(orig_full);
        let base = orig_full.rsplit('/').next().unwrap_or(orig_full);
        let prefix = format!("{base}.~");
        let mut max_ver = 0usize;
        for entry in fs.list_dir(&parent).unwrap_or_default() {
            if let Some(rest) = entry.strip_prefix(&prefix)
                && let Some(num_s) = rest.strip_suffix('~')
                && let Ok(n) = num_s.parse::<usize>()
                && n > max_ver
            {
                max_ver = n;
            }
        }
        if max_ver > 0 || vc == "numbered" {
            return format!("{orig_full}.~{}~", max_ver + 1);
        }
    }
    format!("{orig_full}{}", opts.backup_suffix)
}

#[allow(clippy::too_many_arguments)]
fn flush_patched_file(
    target: &str,
    output_override: Option<&str>,
    file_lines: &[String],
    no_trailing_newline: bool,
    delete_to_dev_null: bool,
    created_from_dev_null: bool,
    should_backup: bool,
    opts: &PatchOpts,
    fs: &dyn SafeBashFs,
    staged_writes: &mut Option<StagedPatchWrites>,
    stdout_patched: &mut String,
) -> Result<(), String> {
    let content = if file_lines.is_empty() {
        String::new()
    } else if no_trailing_newline {
        file_lines.join("\n")
    } else {
        format!("{}\n", file_lines.join("\n"))
    };
    if output_override == Some("-") {
        stdout_patched.push_str(&content);
        return Ok(());
    }
    if opts.dry_run {
        return Ok(());
    }
    let cwd = &opts.work_cwd;
    let orig_full = resolve_posix_path(cwd, target);
    if should_backup && output_override.is_none() && let Ok(orig_bytes) = fs.read_file(&orig_full) {
        let bak_path = compute_backup_path(&orig_full, opts, fs);
        if let Some(staged) = staged_writes {
            staged.push((bak_path, Some(orig_bytes)));
        } else {
            let bak_parent = crate::vfs::dirname_posix_path(&bak_path);
            if !bak_parent.is_empty() && bak_parent != "/" && !fs.exists(&bak_parent) {
                let _ = fs.mkdir_all(&bak_parent);
            }
            let _ = fs.write_file(&bak_path, &orig_bytes);
        }
    }
    let write_target = output_override.unwrap_or(target);
    let full = resolve_posix_path(cwd, write_target);
    if opts.ifdef_guard.is_none() && (delete_to_dev_null || opts.remove_empty) && file_lines.is_empty() {
        if let Some(staged) = staged_writes {
            staged.push((full, None));
        } else {
            let _ = fs.remove(&full, false);
        }
        return Ok(());
    }
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

fn parse_normal_diff_cmd(line: &str) -> Option<(char, usize, usize)> {
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
            let b_start = rhs
                .split(',')
                .next()
                .and_then(|s| s.parse::<usize>().ok())?;
            return Some((op, a_start, b_start));
        }
    }
    None
}

fn resolve_patch_target_path(chosen_raw: &str, strip: Option<usize>, cwd: &str, fs: &dyn SafeBashFs) -> String {
    if let Some(s) = strip {
        return strip_path_components(chosen_raw, s);
    }
    let candidate_full = resolve_posix_path(cwd, chosen_raw);
    if fs.exists(&candidate_full) {
        return chosen_raw.to_string();
    }
    chosen_raw.rsplit('/').next().unwrap_or(chosen_raw).to_string()
}

fn format_context_reject_hunk(raw_hunk_lines: &[String]) -> String {
    let header = raw_hunk_lines.first().map(|s| s.as_str()).unwrap_or("");
    let (old_s, old_c, new_s, new_c) = parse_hunk_starts_and_counts(header);
    let ctx_range = |s: usize, c: usize| -> String {
        if c == 0 {
            "0".to_string()
        } else if c == 1 {
            format!("{s}")
        } else {
            format!("{s},{}", s + c - 1)
        }
    };
    let mut entries: Vec<(char, &str)> = Vec::new();
    for hl in raw_hunk_lines.iter().skip(1) {
        if let Some(r) = hl.strip_prefix('-') {
            entries.push(('-', r));
        } else if let Some(a) = hl.strip_prefix('+') {
            entries.push(('+', a));
        } else if let Some(c) = hl.strip_prefix(' ') {
            entries.push((' ', c));
        }
    }
    let mut out = format!("***************\n*** {} ****\n", ctx_range(old_s, old_c));
    for side in ['-', '+'] {
        if side == '+' {
            out.push_str(&format!("--- {} ----\n", ctx_range(new_s, new_c)));
        }
        let mut idx = 0usize;
        while idx < entries.len() {
            if entries[idx].0 == ' ' {
                out.push_str(&format!("  {}\n", entries[idx].1));
                idx += 1;
                continue;
            }
            let mut end = idx;
            let mut has_rem = false;
            let mut has_add = false;
            while end < entries.len() && entries[end].0 != ' ' {
                if entries[end].0 == '-' {
                    has_rem = true;
                } else if entries[end].0 == '+' {
                    has_add = true;
                }
                end += 1;
            }
            let mark = if has_rem && has_add { '!' } else { side };
            for &(k, text) in &entries[idx..end] {
                if k == side {
                    out.push_str(&format!("{mark} {text}\n"));
                }
            }
            idx = end;
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn apply_unified_diff(
    patch_text: &str,
    explicit_target: Option<&str>,
    output_override: Option<&str>,
    reject_file: Option<&str>,
    opts: &PatchOpts,
    fs: &dyn SafeBashFs,
    stdout_patched: &mut String,
) -> Result<(String, bool), String> {
    let strip = opts.strip;
    let reverse = opts.reverse;
    let dry_run = opts.dry_run;
    let cwd = &opts.work_cwd;
    let action_verb = if dry_run { "checking" } else { "patching" };
    let mut staged_writes: Option<Vec<(String, Option<Vec<u8>>)>> = if opts.atomic {
        Some(Vec::new())
    } else {
        None
    };

    if !patch_text.contains("@@ ") {
        let index_target = patch_text
            .lines()
            .find_map(|l| l.strip_prefix("Index: "))
            .map(|p| {
                let (dec, _) = decode_patch_header_path(p);
                resolve_patch_target_path(&dec, strip, cwd, fs)
            });
        let normal_target = explicit_target
            .map(|s| s.to_string())
            .or(index_target);
        if let Some(target) = normal_target {
            let p_lines: Vec<&str> = patch_text.lines().collect();
            let full = resolve_posix_path(cwd, &target);
            let mut file_lines: Vec<String> = fs
                .read_file(&full)
                .map(|b| String::from_utf8_lossy(&b).lines().map(|s| s.to_string()).collect())
                .unwrap_or_default();
            let mut p_idx = 0usize;
            let mut applied_any = false;
            let mut offset: isize = 0;
            let mut normal_mismatch = false;
            while p_idx < p_lines.len() {
                if let Some((op, a_start, b_start)) = parse_normal_diff_cmd(p_lines[p_idx]) {
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
                    let base_start = if reverse { b_start } else { a_start };
                    if !old_lines.is_empty() {
                        let hint = ((base_start.saturating_sub(1) as isize) + offset).max(0) as usize;
                        if let Some(pos) = find_subslice_pos(&file_lines, &old_lines, hint) {
                            if pos != hint {
                                normal_mismatch = true;
                            }
                            let old_len = old_lines.len();
                            let new_len = new_lines.len();
                            file_lines.splice(pos..pos + old_len, new_lines);
                            offset += (new_len as isize) - (old_len as isize);
                        }
                    } else if !new_lines.is_empty() {
                        let ins_pos = if (op == 'a' && !reverse) || (op == 'd' && reverse) {
                            ((base_start as isize) + offset).clamp(0, file_lines.len() as isize) as usize
                        } else {
                            ((base_start.saturating_sub(1) as isize) + offset)
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
                let should_backup = opts.always_backup || (opts.backup_if_mismatch && normal_mismatch);
                flush_patched_file(
                    &target,
                    output_override,
                    &file_lines,
                    false,
                    false,
                    false,
                    should_backup,
                    opts,
                    fs,
                    &mut staged_writes,
                    stdout_patched,
                )?;
                let msg = if let Some(out_ov) = output_override {
                    format!("{action_verb} file {out_ov} (read from {target})\n")
                } else {
                    format!("{action_verb} file {target}\n")
                };
                return Ok((msg, false));
            }
        }
    }

    let mut current_target: Option<String> = None;
    let mut current_old_hdr = String::new();
    let mut current_new_hdr = String::new();
    let mut pending_minus_raw = String::new();
    let mut pending_minus_epoch = false;
    let mut delete_to_dev_null = false;
    let mut created_from_dev_null = false;
    let mut no_trailing_newline = false;
    let mut file_lines: Vec<String> = Vec::new();
    let mut prev_delta: isize = 0;
    let mut file_hunk_count = 0usize;
    let mut file_failed_count = 0usize;
    let mut file_mismatch = false;
    let mut file_forward_skipped = false;
    let mut file_rej_hunks: Vec<Vec<String>> = Vec::new();
    let mut any_file_failed = false;
    let mut status_out = String::new();

    let finalize_file = |target: &str,
                         old_hdr: &str,
                         new_hdr: &str,
                         file_lines: &[String],
                         no_trailing_newline: bool,
                         delete_to_dev_null: bool,
                         created_from_dev_null: bool,
                         file_hunk_count: usize,
                         file_failed_count: usize,
                         file_mismatch: bool,
                         file_forward_skipped: bool,
                         file_rej_hunks: &[Vec<String>],
                         staged_writes: &mut Option<StagedPatchWrites>,
                         stdout_patched: &mut String,
                         status_out: &mut String,
                         any_file_failed: &mut bool|
     -> Result<(), String> {
        let should_backup = opts.always_backup || (opts.backup_if_mismatch && file_mismatch);
        flush_patched_file(
            target,
            output_override,
            file_lines,
            no_trailing_newline,
            delete_to_dev_null,
            created_from_dev_null,
            should_backup,
            opts,
            fs,
            staged_writes,
            stdout_patched,
        )?;
        if file_failed_count > 0 {
            *any_file_failed = true;
            if !opts.merge_mode && !file_forward_skipped {
                let rej_target = match reject_file {
                    Some("-") => None,
                    Some(r) => Some(r.to_string()),
                    None => Some(format!("{target}.rej")),
                };
                let hunk_word = if file_hunk_count <= 1 { "hunk" } else { "hunks" };
                if !dry_run && let Some(ref rt) = rej_target {
                    status_out.push_str(&format!(
                        "{file_failed_count} out of {} {hunk_word} FAILED -- saving rejects to file {rt}\n",
                        file_hunk_count.max(1),
                    ));
                    let rej_full = resolve_posix_path(cwd, rt);
                    let use_ctx = opts.reject_format.as_deref() == Some("context")
                        || (opts.reject_format.is_none() && opts.was_context_diff);
                    let (r_old, r_new) = if reverse {
                        (new_hdr, old_hdr)
                    } else {
                        (old_hdr, new_hdr)
                    };
                    let mut rej_body = if use_ctx {
                        format!("*** {r_old}\n--- {r_new}\n")
                    } else {
                        format!("--- {r_old}\n+++ {r_new}\n")
                    };
                    for rh in file_rej_hunks {
                        if use_ctx {
                            rej_body.push_str(&format_context_reject_hunk(rh));
                        } else {
                            for l in rh {
                                rej_body.push_str(l);
                                rej_body.push('\n');
                            }
                        }
                    }
                    let _ = fs.write_file(&rej_full, rej_body.as_bytes());
                } else {
                    status_out.push_str(&format!(
                        "{file_failed_count} out of {} {hunk_word} FAILED\n",
                        file_hunk_count.max(1),
                    ));
                }
            }
        }
        Ok(())
    };

    let lines: Vec<&str> = patch_text.lines().collect();
    let mut idx = 0usize;

    while idx < lines.len() {
        let line = lines[idx];
        if let Some(minus_path) = line.strip_prefix("--- ") {
            if let Some(prev_target) = current_target.take() {
                finalize_file(
                    &prev_target,
                    &current_old_hdr,
                    &current_new_hdr,
                    &file_lines,
                    no_trailing_newline,
                    delete_to_dev_null,
                    created_from_dev_null,
                    file_hunk_count,
                    file_failed_count,
                    file_mismatch,
                    file_forward_skipped,
                    &file_rej_hunks,
                    &mut staged_writes,
                    stdout_patched,
                    &mut status_out,
                    &mut any_file_failed,
                )?;
            }
            let (dec_minus, is_ep) = decode_patch_header_path(minus_path);
            pending_minus_raw = dec_minus;
            pending_minus_epoch = is_ep;
            idx += 1;
            continue;
        }
        if let Some(plus_path) = line.strip_prefix("+++ ") {
            let (raw_plus_owned, plus_epoch) = decode_patch_header_path(plus_path);
            let raw_plus = raw_plus_owned.as_str();
            let old_is_null = pending_minus_raw == "/dev/null" || pending_minus_epoch;
            let new_is_null = raw_plus == "/dev/null" || plus_epoch;
            delete_to_dev_null = if reverse { old_is_null } else { new_is_null };
            created_from_dev_null = if reverse { new_is_null } else { old_is_null };
            let chosen_raw = if raw_plus == "/dev/null" {
                pending_minus_raw.as_str()
            } else {
                raw_plus
            };
            let stripped = resolve_patch_target_path(chosen_raw, strip, cwd, fs);
            let target = explicit_target.unwrap_or(&stripped).to_string();
            current_old_hdr = if pending_minus_raw == "/dev/null" {
                "/dev/null".to_string()
            } else {
                resolve_patch_target_path(&pending_minus_raw, strip, cwd, fs)
            };
            current_new_hdr = if raw_plus == "/dev/null" {
                "/dev/null".to_string()
            } else {
                stripped.clone()
            };
            if let Some(out_ov) = output_override {
                status_out.push_str(&format!("{action_verb} file {out_ov} (read from {target})\n"));
            } else {
                status_out.push_str(&format!("{action_verb} file {target}\n"));
            }
            let full = resolve_posix_path(cwd, &target);
            if !created_from_dev_null && let Ok(bytes) = fs.read_file(&full) {
                let s = String::from_utf8_lossy(&bytes);
                no_trailing_newline = !s.is_empty() && !s.ends_with('\n');
                file_lines = s.lines().map(|l| l.to_string()).collect();
            } else {
                no_trailing_newline = false;
                file_lines = Vec::new();
            }
            current_target = Some(target);
            prev_delta = 0;
            file_hunk_count = 0;
            file_failed_count = 0;
            file_mismatch = false;
            file_forward_skipped = false;
            file_rej_hunks.clear();
            idx += 1;
            continue;
        }

        if line.starts_with("@@ ") {
            file_hunk_count += 1;
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
            let (old_start, old_count, new_start, new_count) = parse_hunk_starts_and_counts(line);
            let (orig_start, orig_count) = if reverse {
                (new_start, new_count)
            } else {
                (old_start, old_count)
            };
            idx += 1;
            let mut hunk_old = Vec::new();
            let mut hunk_new = Vec::new();
            let mut hunk_entries: Vec<(char, String)> = Vec::new();
            let mut raw_hunk_lines = vec![hunk_header];
            let mut last_sign = ' ';
            let mut old_no_nl = false;
            let mut new_no_nl = false;
            while idx < lines.len() {
                let hl = lines[idx];
                if hl.starts_with("@@ ")
                    || hl.starts_with("--- ")
                    || hl.starts_with("+++ ")
                    || hl.starts_with("diff ")
                    || hl.starts_with("Index: ")
                    || hl == "-- "
                {
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
                    hunk_entries.push((if reverse { '+' } else { '-' }, rem.to_string()));
                    last_sign = '-';
                } else if let Some(add) = hl.strip_prefix('+') {
                    hunk_new.push(add.to_string());
                    hunk_entries.push((if reverse { '-' } else { '+' }, add.to_string()));
                    last_sign = '+';
                } else if let Some(ctx) = hl.strip_prefix(' ') {
                    hunk_old.push(ctx.to_string());
                    hunk_new.push(ctx.to_string());
                    hunk_entries.push((' ', ctx.to_string()));
                    last_sign = ' ';
                } else if hl.is_empty() {
                    hunk_old.push(String::new());
                    hunk_new.push(String::new());
                    hunk_entries.push((' ', String::new()));
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
            let leading_ctx = hunk_entries.iter().take_while(|(k, _)| *k == ' ').count();
            let trailing_ctx = hunk_entries
                .iter()
                .rev()
                .take(hunk_entries.len().saturating_sub(leading_ctx))
                .take_while(|(k, _)| *k == ' ')
                .count();
            let unshifted_start = if orig_count == 0 && hunk_old.is_empty() {
                orig_start
            } else {
                orig_start.saturating_sub(1)
            };
            let expected_pos = ((unshifted_start as isize) + prev_delta).max(0) as usize;
            let mut match_opt = find_subslice_pos_with_fuzz(
                &file_lines,
                &hunk_old,
                expected_pos,
                leading_ctx,
                trailing_ctx,
                opts.ignore_ws,
                opts.fuzz,
            );

            if match_opt.is_none()
                && !reverse
                && !opts.force
                && !hunk_new.is_empty()
                && let Some(rev_pos) = find_subslice_pos(&file_lines, &hunk_new, expected_pos)
            {
                if opts.forward_only {
                    status_out.push_str("Reversed (or previously applied) patch detected!  Skipping patch.\n");
                    status_out.push_str(&format!(
                        "{file_hunk_count} out of {file_hunk_count} {} ignored\n",
                        if file_hunk_count <= 1 { "hunk" } else { "hunks" }
                    ));
                    file_failed_count += 1;
                    file_forward_skipped = true;
                    continue;
                } else {
                    status_out.push_str("Reversed (or previously applied) patch detected!  Assuming -R.\n");
                    std::mem::swap(&mut hunk_old, &mut hunk_new);
                    for (k, _) in &mut hunk_entries {
                        if *k == '-' {
                            *k = '+';
                        } else if *k == '+' {
                            *k = '-';
                        }
                    }
                    file_mismatch = true;
                    match_opt = Some((rev_pos, 0, 0, 0));
                }
            }

            let (pos, used_fuzz, pf, sf) = match match_opt {
                Some(m) => m,
                None => {
                    file_failed_count += 1;
                    file_mismatch = true;
                    let fail_line = expected_pos + 1;
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
                        status_out.push_str(&format!("Hunk #{file_hunk_count} FAILED at {fail_line}.\n"));
                        file_rej_hunks.push(raw_hunk_lines);
                    }
                    continue;
                }
            };

            let hunk_offset = ((pos as isize) - prev_delta) - (unshifted_start as isize);
            if used_fuzz > 0 || hunk_offset != 0 {
                file_mismatch = true;
                let succeeded_line = pos + 1;
                let fuzz_part = if used_fuzz > 0 {
                    format!(" with fuzz {used_fuzz}")
                } else {
                    String::new()
                };
                let offset_part = if hunk_offset != 0 {
                    let unit = if hunk_offset == 1 { "line" } else { "lines" };
                    format!(" (offset {hunk_offset} {unit})")
                } else {
                    String::new()
                };
                status_out.push_str(&format!(
                    "Hunk #{file_hunk_count} succeeded at {succeeded_line}{fuzz_part}{offset_part}.\n"
                ));
            }

            let splice_start = pos + pf;
            let splice_end = pos + hunk_old.len().saturating_sub(sf);
            let old_slice_len = splice_end.saturating_sub(splice_start);
            let replacement: Vec<String> = if let Some(ref macro_name) = opts.ifdef_guard {
                let entry_end = hunk_entries.len().saturating_sub(sf);
                let active_entries = &hunk_entries[pf.min(entry_end)..entry_end];
                let mut blk = Vec::new();
                let mut ei = 0usize;
                while ei < active_entries.len() {
                    if active_entries[ei].0 == ' ' {
                        blk.push(active_entries[ei].1.clone());
                        ei += 1;
                        continue;
                    }
                    let mut run_end = ei;
                    let mut rem_lines = Vec::new();
                    let mut add_lines = Vec::new();
                    while run_end < active_entries.len() && active_entries[run_end].0 != ' ' {
                        if active_entries[run_end].0 == '-' {
                            rem_lines.push(active_entries[run_end].1.clone());
                        } else if active_entries[run_end].0 == '+' {
                            add_lines.push(active_entries[run_end].1.clone());
                        }
                        run_end += 1;
                    }
                    if !rem_lines.is_empty() && !add_lines.is_empty() {
                        blk.push(format!("#ifndef {macro_name}"));
                        blk.extend(rem_lines);
                        blk.push("#else".to_string());
                        blk.extend(add_lines);
                        blk.push("#endif".to_string());
                    } else if !rem_lines.is_empty() {
                        blk.push(format!("#ifndef {macro_name}"));
                        blk.extend(rem_lines);
                        blk.push("#endif".to_string());
                    } else if !add_lines.is_empty() {
                        blk.push(format!("#ifdef {macro_name}"));
                        blk.extend(add_lines);
                        blk.push("#endif".to_string());
                    }
                    ei = run_end;
                }
                blk
            } else {
                let new_end = hunk_new.len().saturating_sub(sf);
                hunk_new[pf.min(new_end)..new_end].to_vec()
            };
            let new_slice_len = replacement.len();
            file_lines.splice(splice_start..splice_end, replacement);
            prev_delta = (pos as isize) - (unshifted_start as isize) + (new_slice_len as isize) - (old_slice_len as isize);
            continue;
        }
        idx += 1;
    }

    if let Some(target) = current_target {
        finalize_file(
            &target,
            &current_old_hdr,
            &current_new_hdr,
            &file_lines,
            no_trailing_newline,
            delete_to_dev_null,
            created_from_dev_null,
            file_hunk_count,
            file_failed_count,
            file_mismatch,
            file_forward_skipped,
            &file_rej_hunks,
            &mut staged_writes,
            stdout_patched,
            &mut status_out,
            &mut any_file_failed,
        )?;
        if any_file_failed {
            return Ok((status_out, true));
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
        Ok((status_out, false))
    } else {
        Ok((status_out, any_file_failed))
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

fn parse_hunk_starts_and_counts(header: &str) -> (usize, usize, usize, usize) {
    let mut old_s = 1usize;
    let mut old_c = 1usize;
    let mut new_s = 1usize;
    let mut new_c = 1usize;
    for part in header.split_whitespace() {
        if let Some(rest) = part.strip_prefix('-') {
            if let Some((s_str, c_str)) = rest.split_once(',') {
                if let Ok(v) = s_str.parse() {
                    old_s = v;
                }
                if let Ok(v) = c_str.parse() {
                    old_c = v;
                }
            } else if let Ok(v) = rest.parse() {
                old_s = v;
                old_c = 1;
            }
        } else if let Some(rest) = part.strip_prefix('+') {
            if let Some((s_str, c_str)) = rest.split_once(',') {
                if let Ok(v) = s_str.parse() {
                    new_s = v;
                }
                if let Ok(v) = c_str.parse() {
                    new_c = v;
                }
            } else if let Ok(v) = rest.parse() {
                new_s = v;
                new_c = 1;
            }
        }
    }
    (old_s, old_c, new_s, new_c)
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

fn find_subslice_pos_with_fuzz(
    hay: &[String],
    needle: &[String],
    hint: usize,
    leading_ctx: usize,
    trailing_ctx: usize,
    ignore_ws: bool,
    fuzz: usize,
) -> Option<(usize, usize, usize, usize)> {
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
        return Some((pos, 0, 0, 0));
    }
    let max_context = leading_ctx.max(trailing_ctx);
    for tol in 1..=fuzz.min(max_context) {
        let pf = (tol + leading_ctx).saturating_sub(max_context).min(leading_ctx);
        let sf = (tol + trailing_ctx).saturating_sub(max_context).min(trailing_ctx);
        if pf + sf < n_norm.len() {
            let trimmed = &n_norm[pf..n_norm.len() - sf];
            if let Some(inner_pos) = find_subslice_pos(&h_norm, trimmed, hint + pf)
                && inner_pos >= pf
                && inner_pos + trimmed.len() + sf <= h_norm.len()
            {
                return Some((inner_pos - pf, tol, pf, sf));
            }
        }
    }
    None
}

enum StagedPatchOp {
    Write(String, Vec<u8>),
    Delete(String),
}

fn apply_patch_norm(s: &str, pass: u8) -> String {
    if pass == 0 {
        return s.to_string();
    }
    let trimmed = if pass == 1 { s.trim_end() } else { s.trim() };
    if pass < 3 {
        return trimmed.to_string();
    }
    let mut out = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if "‐‑‒–—―−".contains(ch) {
            out.push('-');
        } else if "‘’‚‛".contains(ch) {
            out.push('\'');
        } else if "“”„‟".contains(ch) {
            out.push('"');
        } else if "\u{00a0}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{202f}\u{205f}\u{3000}".contains(ch) {
            out.push(' ');
        } else {
            out.push(ch);
        }
    }
    out
}

fn find_apply_patch_slice(
    lines: &[String],
    pattern: &[String],
    start: usize,
    eof: bool,
) -> Option<usize> {
    if pattern.len() > lines.len() {
        return None;
    }
    let last = lines.len() - pattern.len();
    let first = if eof { last } else { start.min(last) };
    for pass in 0..4u8 {
        for cand in first..=last {
            let mut matched = true;
            for (off, pat) in pattern.iter().enumerate() {
                let act = &lines[cand + off];
                let ok = if pass == 0 {
                    act == pat
                } else {
                    apply_patch_norm(act, pass) == apply_patch_norm(pat, pass)
                };
                if !ok {
                    matched = false;
                    break;
                }
            }
            if matched {
                return Some(cand);
            }
        }
    }
    if !eof && first > 0 {
        for pass in 0..4u8 {
            for cand in 0..first {
                let mut matched = true;
                for (off, pat) in pattern.iter().enumerate() {
                    let act = &lines[cand + off];
                    let ok = if pass == 0 {
                        act == pat
                    } else {
                        apply_patch_norm(act, pass) == apply_patch_norm(pat, pass)
                    };
                    if !ok {
                        matched = false;
                        break;
                    }
                }
                if matched {
                    return Some(cand);
                }
            }
        }
    }
    None
}

fn cmd_apply_patch(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.len() > 1 {
        return err_out("apply_patch: expected stdin or one literal patch argument\n", 2);
    }
    let patch_input = if args.len() == 1 {
        args[0].clone()
    } else {
        stdin.to_string()
    };
    if patch_input.contains('\0') {
        return err_out("apply_patch: NUL bytes are unsupported\n", 2);
    }
    let trimmed_patch = patch_input.trim();
    let lines: Vec<&str> = if trimmed_patch.is_empty() {
        Vec::new()
    } else {
        trimmed_patch.lines().collect()
    };
    if lines.is_empty() || lines[0] != "*** Begin Patch" || *lines.last().unwrap() != "*** End Patch" {
        return err_out("apply_patch: expected Begin Patch and End Patch envelope\n", 2);
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

    let check_path_conflict = |full: &str, target: &str, seen: &mut Vec<String>| -> Option<BuiltinOutcome> {
        for prev in seen.iter() {
            if full == prev
                || full.starts_with(&format!("{prev}/"))
                || prev.starts_with(&format!("{full}/"))
            {
                return Some(err_out(
                    &format!("apply_patch: duplicate or conflicting file target {target}\n"),
                    2,
                ));
            }
        }
        seen.push(full.to_string());
        None
    };

    let mut idx = 1usize;
    let body_end = lines.len() - 1;
    let mut staged_ops: Vec<StagedPatchOp> = Vec::new();
    let mut summary_lines: Vec<String> = Vec::new();
    let mut seen_paths: Vec<String> = Vec::new();

    while idx < body_end {
        let line = lines[idx];
        if let Some(path) = line.strip_prefix("*** Add File: ") {
            let target = path.trim();
            idx += 1;
            let mut content_lines = Vec::new();
            while idx < body_end
                && !lines[idx].starts_with("*** Add File: ")
                && !lines[idx].starts_with("*** Delete File: ")
                && !lines[idx].starts_with("*** Update File: ")
            {
                if let Some(added) = lines[idx].strip_prefix('+') {
                    content_lines.push(added);
                } else {
                    return err_out(&format!("apply_patch: invalid Add body at patch line {}\n", idx + 1), 2);
                }
                idx += 1;
            }
            let full = resolve_posix_path(cwd, target);
            if let Some(err) = reject_unsafe_target(target, &full) {
                return err;
            }
            if let Some(err) = check_path_conflict(&full, target, &mut seen_paths) {
                return err;
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
            idx += 1;
            if idx < body_end
                && !lines[idx].starts_with("*** Add File: ")
                && !lines[idx].starts_with("*** Delete File: ")
                && !lines[idx].starts_with("*** Update File: ")
            {
                return err_out("apply_patch: Delete cannot have a body\n", 2);
            }
            let full = resolve_posix_path(cwd, target);
            if let Some(err) = reject_unsafe_target(target, &full) {
                return err;
            }
            if let Some(err) = check_path_conflict(&full, target, &mut seen_paths) {
                return err;
            }
            if !fs.exists(&full) {
                return err_out(&format!("apply_patch: {target}: No such file\n"), 1);
            }
            staged_ops.push(StagedPatchOp::Delete(full));
            summary_lines.push(format!("D {target}"));
            continue;
        }
        if let Some(path) = line.strip_prefix("*** Update File: ") {
            let target = path.trim();
            let full = resolve_posix_path(cwd, target);
            if let Some(err) = reject_unsafe_target(target, &full) {
                return err;
            }
            if let Some(err) = check_path_conflict(&full, target, &mut seen_paths) {
                return err;
            }
            let orig_bytes = match fs.read_file(&full) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("apply_patch: {}\n", e), 1),
            };
            let orig = String::from_utf8_lossy(&orig_bytes).into_owned();
            let terminated = orig.is_empty() || orig.ends_with('\n');
            let use_crlf = orig.contains("\r\n");
            let line_sep = if use_crlf { "\r\n" } else { "\n" };
            let mut file_lines: Vec<String> = orig.lines().map(|s| s.to_string()).collect();
            idx += 1;
            let mut move_to: Option<String> = None;
            if idx < body_end && let Some(mv) = lines[idx].strip_prefix("*** Move to: ") {
                move_to = Some(mv.trim().to_string());
                idx += 1;
            }
            let mut cursor = 0usize;
            let mut any_hunk = false;
            while idx < body_end
                && !lines[idx].starts_with("*** Add File: ")
                && !lines[idx].starts_with("*** Delete File: ")
                && !lines[idx].starts_with("*** Update File: ")
            {
                if lines[idx] == "*** End of File" {
                    idx += 1;
                    continue;
                }
                if lines[idx].starts_with("@@")
                    || lines[idx].starts_with(' ')
                    || lines[idx].starts_with('+')
                    || lines[idx].starts_with('-')
                    || lines[idx].is_empty()
                {
                    any_hunk = true;
                    let mut anchors = Vec::new();
                    while idx < body_end && lines[idx].starts_with("@@") {
                        let anchor = lines[idx].strip_prefix("@@").unwrap_or("").trim();
                        if !anchor.is_empty() {
                            anchors.push(anchor.to_string());
                        }
                        idx += 1;
                    }
                    let mut hunk_items: Vec<(char, String)> = Vec::new();
                    while idx < body_end
                        && !lines[idx].starts_with("@@")
                        && !lines[idx].starts_with("*** Add File: ")
                        && !lines[idx].starts_with("*** Delete File: ")
                        && !lines[idx].starts_with("*** Update File: ")
                        && lines[idx] != "*** End of File"
                    {
                        let hl = lines[idx];
                        if let Some(r) = hl.strip_prefix('-') {
                            hunk_items.push(('-', r.to_string()));
                        } else if let Some(a) = hl.strip_prefix('+') {
                            hunk_items.push(('+', a.to_string()));
                        } else if let Some(c) = hl.strip_prefix(' ') {
                            hunk_items.push((' ', c.to_string()));
                        } else if hl.is_empty() {
                            hunk_items.push((' ', String::new()));
                        } else {
                            return err_out(&format!("apply_patch: invalid hunk line {}\n", idx + 1), 2);
                        }
                        idx += 1;
                    }
                    if hunk_items.is_empty() {
                        return err_out("apply_patch: Update requires a nonempty hunk\n", 2);
                    }
                    let mut hunk_eof = false;
                    if idx < body_end && lines[idx] == "*** End of File" {
                        hunk_eof = true;
                        idx += 1;
                    }
                    let mut anchor_pos: Option<usize> = None;
                    for anc in &anchors {
                        if let Some(apos) = find_apply_patch_slice(&file_lines, std::slice::from_ref(anc), cursor, false) {
                            cursor = apos + 1;
                            anchor_pos = Some(apos);
                        }
                    }
                    let old_block: Vec<String> = hunk_items
                        .iter()
                        .filter(|(k, _)| *k != '+')
                        .map(|(_, s)| s.clone())
                        .collect();
                    let search_start = if let Some(ap) = anchor_pos
                        && !old_block.is_empty()
                        && apply_patch_norm(&file_lines[ap], 3) == apply_patch_norm(&old_block[0], 3)
                    {
                        ap
                    } else {
                        cursor
                    };
                    let pos_opt = if old_block.is_empty() {
                        Some(if hunk_eof { file_lines.len() } else { search_start.min(file_lines.len()) })
                    } else {
                        find_apply_patch_slice(&file_lines, &old_block, search_start, hunk_eof)
                    };
                    if let Some(pos) = pos_opt {
                        let mut replacement = Vec::new();
                        let mut matched = pos;
                        for (kind, text) in hunk_items {
                            match kind {
                                ' ' => {
                                    replacement.push(file_lines[matched].clone());
                                    matched += 1;
                                }
                                '-' => {
                                    matched += 1;
                                }
                                '+' => {
                                    replacement.push(text);
                                }
                                _ => {}
                            }
                        }
                        let rep_len = replacement.len();
                        file_lines.splice(pos..pos + old_block.len(), replacement);
                        cursor = pos + rep_len;
                    } else {
                        return err_out("apply_patch: context mismatch\n", 1);
                    }
                } else {
                    return err_out(&format!("apply_patch: invalid hunk line {}\n", idx + 1), 2);
                }
            }
            if !any_hunk && move_to.is_none() {
                return err_out("apply_patch: Update requires a nonempty hunk\n", 2);
            }
            let updated_bytes = if !any_hunk {
                orig_bytes
            } else if file_lines.is_empty() {
                Vec::new()
            } else if terminated {
                format!("{}{line_sep}", file_lines.join(line_sep)).into_bytes()
            } else {
                file_lines.join(line_sep).into_bytes()
            };
            if let Some(dest) = move_to {
                let dest_full = resolve_posix_path(cwd, &dest);
                if let Some(err) = reject_unsafe_target(&dest, &dest_full) {
                    return err;
                }
                if dest_full != full {
                    if let Some(err) = check_path_conflict(&dest_full, &dest, &mut seen_paths) {
                        return err;
                    }
                    if fs.exists(&dest_full) {
                        return err_out(&format!("apply_patch: {dest}: destination already exists\n"), 1);
                    }
                    staged_ops.push(StagedPatchOp::Delete(full));
                }
                staged_ops.push(StagedPatchOp::Write(dest_full, updated_bytes));
                summary_lines.push(format!("M {dest}"));
            } else {
                staged_ops.push(StagedPatchOp::Write(full, updated_bytes));
                summary_lines.push(format!("M {target}"));
            }
            continue;
        }
        return err_out(&format!("apply_patch: invalid file header at patch line {}\n", idx + 1), 2);
    }
    if staged_ops.is_empty() {
        return err_out("apply_patch: patch contains no file operations\n", 2);
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
fn parse_cmp_byte_count(raw: &str) -> Result<usize, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err(format!("invalid byte count '{raw}'"));
    }
    let s = s.strip_prefix('+').unwrap_or(s);
    let (base, rest) = if let Some(h) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        (16u32, h)
    } else if s.starts_with('0') && s.len() > 1 && s[1..].chars().next().is_some_and(|c| c.is_ascii_digit()) {
        (8u32, &s[1..])
    } else {
        (10u32, s)
    };
    let mut split_idx = 0usize;
    for (idx, ch) in rest.char_indices() {
        if ch.to_digit(base).is_some() {
            split_idx = idx + ch.len_utf8();
        } else {
            break;
        }
    }
    let num_part = &rest[..split_idx];
    let suf_part = &rest[split_idx..];
    let mut val: u128 = if num_part.is_empty() {
        if base != 10 || suf_part.is_empty() {
            return Err(format!("invalid byte count '{raw}'"));
        }
        1
    } else {
        u128::from_str_radix(num_part, base).map_err(|_| format!("invalid byte count '{raw}'"))?
    };
    if !suf_part.is_empty() {
        let first = suf_part.chars().next().unwrap();
        let power: u32 = match first {
            'k' | 'K' => 1,
            'M' => 2,
            'G' => 3,
            'T' => 4,
            'P' => 5,
            'E' => 6,
            _ => return Err(format!("invalid byte count '{raw}'")),
        };
        let tail = &suf_part[first.len_utf8()..];
        let mult: u128 = match tail {
            "" | "iB" => 1024u128.pow(power),
            "B" | "D" => 1000u128.pow(power),
            _ => return Err(format!("invalid byte count '{raw}'")),
        };
        val = val.saturating_mul(mult);
    }
    Ok(val.min(usize::MAX as u128) as usize)
}

fn cmp_print_byte(byte: u8) -> String {
    let prefix = if byte >= 128 { "M-" } else { "" };
    let ch = byte & 127;
    let body = if ch < 32 {
        format!("^{}", (ch + 64) as char)
    } else if ch == 127 {
        "^?".to_string()
    } else {
        (ch as char).to_string()
    };
    format!("{prefix}{body}")
}

fn cmd_cmp(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut silent = false;
    let mut verbose_list = false;
    let mut print_bytes = false;
    let mut skips = (0usize, 0usize);
    let mut max_bytes: Option<usize> = None;
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    let posixly_correct = env.contains_key("POSIXLY_CORRECT");

    let apply_skip = |v: &str, sk: &mut (usize, usize)| -> Result<(), String> {
        if let Some((s1, s2)) = v.split_once(':') {
            let n1 = parse_cmp_byte_count(s1)?;
            let n2 = parse_cmp_byte_count(s2)?;
            sk.0 = sk.0.max(n1);
            sk.1 = sk.1.max(n2);
        } else {
            let n = parse_cmp_byte_count(v)?;
            sk.0 = sk.0.max(n);
            sk.1 = sk.1.max(n);
        }
        Ok(())
    };

    let long_opts: &[(&str, char)] = &[
        ("print-bytes", 'b'),
        ("print-chars", 'c'),
        ("ignore-initial", 'i'),
        ("verbose", 'l'),
        ("bytes", 'n'),
        ("silent", 's'),
        ("quiet", 's'),
        ("version", 'v'),
        ("help", 'h'),
    ];

    while i < args.len() {
        let a = &args[i];
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.clone());
            if posixly_correct {
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
        if a.starts_with("--") {
            let (name, eq_val) = match a[2..].split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (&a[2..], None),
            };
            let exact = long_opts.iter().find(|&&(k, _)| k == name).copied();
            let selected = if let Some(ex) = exact {
                ex
            } else {
                let matches: Vec<(&str, char)> = long_opts
                    .iter()
                    .copied()
                    .filter(|&(k, _)| k.starts_with(name))
                    .collect();
                if matches.is_empty() {
                    return err_out(&format!("cmp: unrecognized option '{a}'\n"), 2);
                }
                let first_key = matches[0].1;
                if matches.iter().any(|&(_, ch)| ch != first_key) {
                    let poss: Vec<String> = matches.iter().map(|&(k, _)| format!("'--{k}'")).collect();
                    return err_out(
                        &format!("cmp: option '{a}' is ambiguous; possibilities: {}\n", poss.join(" ")),
                        2,
                    );
                }
                matches[0]
            };
            let (sel_name, key) = selected;
            match key {
                's' => {
                    if eq_val.is_some() {
                        return err_out(&format!("cmp: option '--{sel_name}' doesn't allow an argument\n"), 2);
                    }
                    if verbose_list {
                        return err_out("cmp: options -l and -s are incompatible\n", 2);
                    }
                    silent = true;
                    i += 1;
                }
                'l' => {
                    if eq_val.is_some() {
                        return err_out(&format!("cmp: option '--{sel_name}' doesn't allow an argument\n"), 2);
                    }
                    if silent {
                        return err_out("cmp: options -l and -s are incompatible\n", 2);
                    }
                    verbose_list = true;
                    i += 1;
                }
                'b' | 'c' => {
                    if eq_val.is_some() {
                        return err_out(&format!("cmp: option '--{sel_name}' doesn't allow an argument\n"), 2);
                    }
                    print_bytes = true;
                    i += 1;
                }
                'v' => {
                    if eq_val.is_some() {
                        return err_out(&format!("cmp: option '--{sel_name}' doesn't allow an argument\n"), 2);
                    }
                    return ok_out("cmp (GNU diffutils) 3.10\n");
                }
                'h' => {
                    if eq_val.is_some() {
                        return err_out(&format!("cmp: option '--{sel_name}' doesn't allow an argument\n"), 2);
                    }
                    return ok_out("Usage: cmp [OPTION]... FILE1 [FILE2 [SKIP1 [SKIP2]]]\n");
                }
                'i' => {
                    let val = if let Some(v) = eq_val {
                        i += 1;
                        v.to_string()
                    } else if i + 1 < args.len() {
                        let v = args[i + 1].clone();
                        i += 2;
                        v
                    } else {
                        return err_out(&format!("cmp: option '--{sel_name}' requires an argument\n"), 2);
                    };
                    if let Err(e) = apply_skip(&val, &mut skips) {
                        return err_out(&format!("cmp: {e}\n"), 2);
                    }
                }
                'n' => {
                    let val = if let Some(v) = eq_val {
                        i += 1;
                        v.to_string()
                    } else if i + 1 < args.len() {
                        let v = args[i + 1].clone();
                        i += 2;
                        v
                    } else {
                        return err_out(&format!("cmp: option '--{sel_name}' requires an argument\n"), 2);
                    };
                    match parse_cmp_byte_count(&val) {
                        Ok(n) => max_bytes = Some(max_bytes.map_or(n, |p| p.min(n))),
                        Err(e) => return err_out(&format!("cmp: {e}\n"), 2),
                    }
                }
                _ => unreachable!(),
            }
        } else {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                match chars[ci] {
                    's' => {
                        if verbose_list {
                            return err_out("cmp: options -l and -s are incompatible\n", 2);
                        }
                        silent = true;
                    }
                    'l' => {
                        if silent {
                            return err_out("cmp: options -l and -s are incompatible\n", 2);
                        }
                        verbose_list = true;
                    }
                    'b' | 'c' => print_bytes = true,
                    'v' => return ok_out("cmp (GNU diffutils) 3.10\n"),
                    'i' => {
                        let rest: String = chars[ci + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            rest
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return err_out("cmp: option requires an argument -- 'i'\n", 2);
                        };
                        if let Err(e) = apply_skip(&val, &mut skips) {
                            return err_out(&format!("cmp: {e}\n"), 2);
                        }
                        break;
                    }
                    'n' => {
                        let rest: String = chars[ci + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            rest
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return err_out("cmp: option requires an argument -- 'n'\n", 2);
                        };
                        match parse_cmp_byte_count(&val) {
                            Ok(n) => max_bytes = Some(max_bytes.map_or(n, |p| p.min(n))),
                            Err(e) => return err_out(&format!("cmp: {e}\n"), 2),
                        }
                        break;
                    }
                    other => return err_out(&format!("cmp: invalid option -- '{other}'\n"), 2),
                }
                ci += 1;
            }
            i += 1;
        }
    }

    if files.is_empty() {
        return err_out("cmp: missing operand\n", 2);
    }
    if files.len() > 4 {
        return err_out(&format!("cmp: extra operand '{}'\n", files[4]), 2);
    }
    let name1 = files[0].clone();
    let name2 = files.get(1).cloned().unwrap_or_else(|| "-".to_string());
    if let Some(pos_s1) = files.get(2) {
        match parse_cmp_byte_count(pos_s1) {
            Ok(n) => skips.0 = skips.0.max(n),
            Err(e) => return err_out(&format!("cmp: {e}\n"), 2),
        }
    }
    if let Some(pos_s2) = files.get(3) {
        match parse_cmp_byte_count(pos_s2) {
            Ok(n) => skips.1 = skips.1.max(n),
            Err(e) => return err_out(&format!("cmp: {e}\n"), 2),
        }
    }
    if name1 == "-" && name2 == "-" {
        return ok_out("");
    }

    let read_b = |f: &str| -> Result<Vec<u8>, (String, bool)> {
        if f == "-" {
            return Ok(crate::vfs::stream_string_to_bytes(stdin));
        }
        let full = resolve_posix_path(cwd, f);
        if fs.is_dir(&full) {
            return Err((format!("cmp: {f}: Is a directory\n"), false));
        }
        fs.read_file(&full)
            .map_err(|_| (format!("cmp: {f}: No such file or directory\n"), true))
    };
    let raw1 = match read_b(&name1) {
        Ok(b) => b,
        Err((e, suppress_silent)) => return err_out(if silent && suppress_silent { "" } else { &e }, 2),
    };
    let raw2 = match read_b(&name2) {
        Ok(b) => b,
        Err((e, suppress_silent)) => return err_out(if silent && suppress_silent { "" } else { &e }, 2),
    };
    let mut b1 = raw1[skips.0.min(raw1.len())..].to_vec();
    let mut b2 = raw2[skips.1.min(raw2.len())..].to_vec();
    let mut known = usize::MAX;
    if name1 != "-" {
        known = known.min(b1.len());
    }
    if name2 != "-" {
        known = known.min(b2.len());
    }
    if let Some(limit) = max_bytes {
        known = known.min(limit);
        b1.truncate(limit);
        b2.truncate(limit);
    }
    let width = if known < usize::MAX {
        known.to_string().len()
    } else {
        19
    };

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
    let mut newlines = 0usize;
    let mut last_byte: Option<u8> = None;
    let mut out = String::new();

    for idx in 0..min_len {
        let c1 = b1[idx];
        let c2 = b2[idx];
        let compared = idx + 1;
        if c1 != c2 {
            if !verbose_list {
                let locale = env
                    .get("LC_ALL")
                    .or_else(|| env.get("LC_MESSAGES"))
                    .or_else(|| env.get("LANG"))
                    .map(|s| s.as_str())
                    .unwrap_or("");
                let unit = if !print_bytes && (locale.is_empty() || locale == "C" || locale == "POSIX") {
                    "char"
                } else {
                    "byte"
                };
                let detail = if print_bytes {
                    format!(
                        " is {:>3o} {} {:>3o} {}",
                        c1,
                        cmp_print_byte(c1),
                        c2,
                        cmp_print_byte(c2)
                    )
                } else {
                    String::new()
                };
                return BuiltinOutcome {
                    stdout: format!(
                        "{name1} {name2} differ: {unit} {compared}, line {}{detail}\n",
                        newlines + 1
                    ),
                    stderr: String::new(),
                    exit_code: 1,
                };
            }
            if print_bytes {
                out.push_str(&format!(
                    "{compared:>width$} {:>3o} {:<4} {:>3o} {}\n",
                    c1,
                    cmp_print_byte(c1),
                    c2,
                    cmp_print_byte(c2),
                    width = width
                ));
            } else {
                out.push_str(&format!(
                    "{compared:>width$} {:>3o} {:>3o}\n",
                    c1,
                    c2,
                    width = width
                ));
            }
        }
        if c1 == b'\n' {
            newlines += 1;
        }
        last_byte = Some(c1);
    }

    let mut stderr = String::new();
    if b1.len() != b2.len() {
        let shorter = if b1.len() < b2.len() { &name1 } else { &name2 };
        let detail = if min_len == 0 {
            "which is empty".to_string()
        } else if verbose_list {
            format!("after byte {min_len}")
        } else if last_byte == Some(b'\n') {
            format!("after byte {min_len}, line {newlines}")
        } else {
            format!("after byte {min_len}, in line {}", newlines + 1)
        };
        stderr = format!("cmp: EOF on {shorter} {detail}\n");
    }

    BuiltinOutcome {
        stdout: out,
        stderr,
        exit_code: 1,
    }
}

#[derive(Clone, Copy)]
struct Diff3Range {
    start: usize,
    end: usize,
}

#[derive(Clone, Copy)]
struct Diff3Edit {
    base: Diff3Range,
    variant: Diff3Range,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Diff3RegionKind {
    Left,
    Right,
    Identical,
    Adjacent,
    Conflict,
}

#[derive(Clone, Copy)]
struct Diff3Region {
    kind: Diff3RegionKind,
    base: Diff3Range,
    left: Diff3Range,
    right: Diff3Range,
}

fn diff3_pair_edits(base: &[String], variant: &[String]) -> Vec<Diff3Edit> {
    let raw = compute_lcs_edits(base, variant);
    let mut edits = Vec::new();
    let mut b_idx = 0usize;
    let mut v_idx = 0usize;
    let mut ei = 0usize;
    while ei < raw.len() {
        if matches!(raw[ei], DiffEdit::Keep(_)) {
            b_idx += 1;
            v_idx += 1;
            ei += 1;
            continue;
        }
        let b_start = b_idx;
        let v_start = v_idx;
        while ei < raw.len() && !matches!(raw[ei], DiffEdit::Keep(_)) {
            match raw[ei] {
                DiffEdit::Delete(_) => b_idx += 1,
                DiffEdit::Insert(_) => v_idx += 1,
                DiffEdit::Keep(_) => break,
            }
            ei += 1;
        }
        edits.push(Diff3Edit {
            base: Diff3Range {
                start: b_start,
                end: b_idx,
            },
            variant: Diff3Range {
                start: v_start,
                end: v_idx,
            },
        });
    }
    edits
}

fn diff3_align_regions(
    left_lines: &[String],
    right_lines: &[String],
    left: &[Diff3Edit],
    right: &[Diff3Edit],
) -> Vec<Diff3Region> {
    let streams = [left, right];
    let mut offsets = [0usize, 0usize];
    let mut delta = [0isize, 0isize];
    let mut result = Vec::new();

    while offsets[0] < left.len() || offsets[1] < right.len() {
        let next_left = left.get(offsets[0]);
        let next_right = right.get(offsets[1]);
        let first_side = if next_right.is_none()
            || next_left.is_some_and(|nl| nl.base.start <= next_right.unwrap().base.start)
        {
            0
        } else {
            1
        };
        let first = streams[first_side][offsets[first_side]];
        let start = first.base.start;
        let mut end = first.base.end;
        let initial_delta = delta;
        let mut seen = [false, false];
        let mut overlap = false;
        let mut last: [Option<Diff3Range>; 2] = [None, None];

        loop {
            let a = left.get(offsets[0]);
            let b = right.get(offsets[1]);
            let side = if b.is_none() || a.is_some_and(|al| al.base.start <= b.unwrap().base.start) {
                0
            } else {
                1
            };
            let Some(edit) = streams[side].get(offsets[side]).copied() else {
                break;
            };
            if edit.base.start > end {
                break;
            }
            if let Some(other) = last[1 - side] {
                let a_empty = edit.base.start == edit.base.end;
                let b_empty = other.start == other.end;
                let ov = if a_empty && b_empty {
                    edit.base.start == other.start
                } else if a_empty {
                    edit.base.start > other.start && edit.base.start < other.end
                } else if b_empty {
                    other.start > edit.base.start && other.start < edit.base.end
                } else {
                    edit.base.start < other.end && other.start < edit.base.end
                };
                overlap = overlap || ov;
            }
            last[side] = Some(edit.base);
            seen[side] = true;
            end = end.max(edit.base.end);
            delta[side] = (edit.variant.end as isize) - (edit.base.end as isize);
            offsets[side] += 1;
        }
        let base = Diff3Range { start, end };
        let l = Diff3Range {
            start: ((start as isize) + initial_delta[0]) as usize,
            end: ((end as isize) + delta[0]) as usize,
        };
        let r = Diff3Range {
            start: ((start as isize) + initial_delta[1]) as usize,
            end: ((end as isize) + delta[1]) as usize,
        };
        let mut kind = if !seen[0] {
            Diff3RegionKind::Right
        } else if !seen[1] {
            Diff3RegionKind::Left
        } else if overlap {
            Diff3RegionKind::Conflict
        } else {
            Diff3RegionKind::Adjacent
        };
        if seen[0]
            && seen[1]
            && l.end - l.start == r.end - r.start
            && left_lines[l.start..l.end] == right_lines[r.start..r.end]
        {
            kind = Diff3RegionKind::Identical;
        }
        result.push(Diff3Region {
            kind,
            base,
            left: l,
            right: r,
        });
    }
    result
}

#[derive(Clone, PartialEq, Eq)]
struct Diff3Line {
    text: String,
    terminated: bool,
}

impl Diff3Line {
    fn cmp_key(&self, strip_cr: bool) -> String {
        let body = if strip_cr && self.terminated {
            self.text.strip_suffix('\r').unwrap_or(&self.text)
        } else {
            &self.text
        };
        if self.terminated {
            format!("{body}\n")
        } else {
            body.to_string()
        }
    }
}

fn cmd_diff3(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut merge = false;
    let mut selector: Option<char> = None;
    let mut write_quit = false;
    let mut initial_tab = false;
    let mut strip_trailing_cr = false;
    let mut labels: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    let set_selector = |sel: &mut Option<char>, ch: char| -> Result<(), String> {
        if let Some(prev) = *sel
            && prev != ch
        {
            return Err("diff3: incompatible script selectors\n".to_string());
        }
        *sel = Some(ch);
        Ok(())
    };
    while i < args.len() {
        let a = &args[i];
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
        if a == "--help" {
            return ok_out("Usage: diff3 [OPTION]... OURS BASE THEIRS\n");
        }
        if a == "-v" || a == "--version" {
            return ok_out("diff3 (safe-bash; GNU diffutils 3.12 qualified profile)\n");
        }
        if a == "-m" || a == "--merge" {
            merge = true;
            i += 1;
        } else if a == "-A" || a == "--show-all" {
            if let Err(e) = set_selector(&mut selector, 'A') {
                return err_out(&e, 2);
            }
            i += 1;
        } else if a == "-e" || a == "--ed" {
            if let Err(e) = set_selector(&mut selector, 'e') {
                return err_out(&e, 2);
            }
            i += 1;
        } else if a == "-E" || a == "--show-overlap" {
            if let Err(e) = set_selector(&mut selector, 'E') {
                return err_out(&e, 2);
            }
            i += 1;
        } else if a == "-x" || a == "--overlap-only" {
            if let Err(e) = set_selector(&mut selector, 'x') {
                return err_out(&e, 2);
            }
            i += 1;
        } else if a == "-X" {
            if let Err(e) = set_selector(&mut selector, 'X') {
                return err_out(&e, 2);
            }
            i += 1;
        } else if a == "-3" || a == "--easy-only" {
            if let Err(e) = set_selector(&mut selector, '3') {
                return err_out(&e, 2);
            }
            i += 1;
        } else if a == "-i" {
            write_quit = true;
            i += 1;
        } else if a == "-T" || a == "--initial-tab" {
            initial_tab = true;
            i += 1;
        } else if a == "--strip-trailing-cr" {
            strip_trailing_cr = true;
            i += 1;
        } else if a == "-a" || a == "--text" {
            i += 1;
        } else if (a == "-L" || a == "--label") && i + 1 < args.len() {
            labels.push(args[i + 1].clone());
            i += 2;
        } else if let Some(lbl) = a.strip_prefix("--label=") {
            labels.push(lbl.to_string());
            i += 1;
        } else if a.starts_with("--") {
            return err_out(&format!("diff3: unrecognized option '{a}'\n"), 2);
        } else {
            for (byte_off, ch) in a[1..].char_indices() {
                match ch {
                    'm' => merge = true,
                    'A' | 'e' | 'E' | 'x' | 'X' | '3' => {
                        if let Err(e) = set_selector(&mut selector, ch) {
                            return err_out(&e, 2);
                        }
                    }
                    'i' => write_quit = true,
                    'T' => initial_tab = true,
                    'a' => {}
                    'v' => return ok_out("diff3 (safe-bash; GNU diffutils 3.12 qualified profile)\n"),
                    'L' => {
                        let rest = &a[1 + byte_off + ch.len_utf8()..];
                        let val = if !rest.is_empty() {
                            rest.to_string()
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return err_out("diff3: option requires an argument -- 'L'\n", 2);
                        };
                        labels.push(val);
                        break;
                    }
                    other => return err_out(&format!("diff3: invalid option -- '{other}'\n"), 2),
                }
            }
            i += 1;
        }
    }
    let eff_sel = selector.or(if merge { Some('A') } else { None });
    if merge && write_quit {
        return err_out("diff3: incompatible options: -m and -i\n", 2);
    }
    if labels.len() > 3 {
        return err_out("diff3: too many file labels\n", 2);
    }
    if !labels.is_empty() && !matches!(eff_sel, Some('A' | 'E' | 'X')) {
        return err_out("diff3: labels require a flagging mode\n", 2);
    }
    if files.len() != 3 {
        return err_out("diff3: expected three operands\n", 2);
    }
    if files.iter().filter(|f| f.as_str() == "-").count() > 1 {
        return err_out("diff3: '-' specified for more than one input file\n", 2);
    }
    let read_lines = |p: &str| -> Result<Vec<Diff3Line>, String> {
        let text = if p == "-" {
            stdin.to_string()
        } else {
            let full = resolve_posix_path(cwd, p);
            let bytes = fs
                .read_file(&full)
                .map_err(|_| format!("diff3: {p}: No such file or directory\n"))?;
            String::from_utf8_lossy(&bytes).into_owned()
        };
        Ok(split_diff_lines(&text)
            .into_iter()
            .map(|(l, term)| Diff3Line {
                text: l.to_string(),
                terminated: term,
            })
            .collect())
    };
    let f0 = match read_lines(&files[0]) {
        Ok(v) => v,
        Err(e) => return err_out(&e, 2),
    };
    let f1 = match read_lines(&files[1]) {
        Ok(v) => v,
        Err(e) => return err_out(&e, 2),
    };
    let f2 = match read_lines(&files[2]) {
        Ok(v) => v,
        Err(e) => return err_out(&e, 2),
    };
    let all_files = [f0, f1, f2];
    let lbls = [
        labels.first().unwrap_or(&files[0]).clone(),
        labels.get(1).unwrap_or(&files[1]).clone(),
        labels.get(2).unwrap_or(&files[2]).clone(),
    ];

    let report = selector.is_none() && !merge;
    let sel = selector.unwrap_or('A');
    let preferred_common = if report { 2usize } else { 1usize };
    let common = if files[preferred_common] == "-" {
        3 - preferred_common
    } else {
        preferred_common
    };
    let other = 3 - common;

    let base_lines = &all_files[common];
    let left_lines = &all_files[0];
    let right_lines = &all_files[other];
    let base_keys: Vec<String> = base_lines.iter().map(|l| l.cmp_key(strip_trailing_cr)).collect();
    let left_keys: Vec<String> = left_lines.iter().map(|l| l.cmp_key(strip_trailing_cr)).collect();
    let right_keys: Vec<String> = right_lines.iter().map(|l| l.cmp_key(strip_trailing_cr)).collect();
    let left_edits = diff3_pair_edits(&base_keys, &left_keys);
    let right_edits = diff3_pair_edits(&base_keys, &right_keys);
    let mut stderr = String::new();
    if !report && !merge {
        for (edits, variant_lines) in [(&left_edits, left_lines), (&right_edits, right_lines)] {
            for edit in edits {
                if edit.base.end > edit.base.start && !base_lines[edit.base.end - 1].terminated {
                    stderr.push_str("diff3: No newline at end of file\n");
                }
                if edit.variant.end > edit.variant.start
                    && !variant_lines[edit.variant.end - 1].terminated
                {
                    stderr.push_str("diff3: No newline at end of file\n");
                }
            }
        }
    }
    let mut regions = diff3_align_regions(&left_keys, &right_keys, &left_edits, &right_edits);
    if !merge && !report {
        regions.reverse();
    }

    let address = |r: Diff3Range| -> String {
        if r.start == r.end {
            format!("{}a", r.start)
        } else if r.start + 1 == r.end {
            format!("{}c", r.start + 1)
        } else {
            format!("{},{}c", r.start + 1, r.end)
        }
    };
    let indent = if initial_tab { "\t" } else { "  " };
    let emit_range = |out: &mut String, file_idx: usize, r: Diff3Range, mode: &str| -> bool {
        let mut dots = false;
        for token in &all_files[file_idx][r.start..r.end] {
            if mode == "report" {
                out.push_str(indent);
            } else if mode == "ed" && token.text.starts_with('.') {
                dots = true;
                out.push('.');
            }
            if mode == "source" {
                out.push_str(&token.text);
                if token.terminated {
                    out.push('\n');
                }
            } else {
                let body = if strip_trailing_cr && token.terminated {
                    token.text.strip_suffix('\r').unwrap_or(&token.text)
                } else {
                    &token.text
                };
                out.push_str(body);
                if token.terminated || mode == "ed" || mode == "report" {
                    out.push('\n');
                }
                if !token.terminated && mode == "report" {
                    out.push_str("\\ No newline at end of file\n");
                }
            }
        }
        dots
    };

    let mut out = String::new();
    let mut conflict = false;
    let mut cursor = 0usize;

    for region in regions {
        let mut ranges = [
            Diff3Range { start: 0, end: 0 },
            Diff3Range { start: 0, end: 0 },
            Diff3Range { start: 0, end: 0 },
        ];
        ranges[0] = region.left;
        ranges[other] = region.right;
        ranges[common] = region.base;
        let base_r = ranges[1];
        let theirs_r = ranges[2];
        let different = match region.kind {
            Diff3RegionKind::Left => 1usize,
            Diff3RegionKind::Right => other + 1,
            Diff3RegionKind::Identical => common + 1,
            Diff3RegionKind::Adjacent | Diff3RegionKind::Conflict => 0,
        };
        if report {
            if different == 0 {
                out.push_str("====\n");
            } else {
                out.push_str(&format!("===={different}\n"));
            }
            let sequence = if different == 2 { [0usize, 2, 1] } else { [0usize, 1, 2] };
            for (seq_i, &file_idx) in sequence.iter().enumerate() {
                out.push_str(&format!("{}:{}\n", file_idx + 1, address(ranges[file_idx])));
                if different == 0
                    || file_idx + 1 == different
                    || (seq_i == 1 && different != 1)
                    || (seq_i == 2 && different == 1)
                {
                    emit_range(&mut out, file_idx, ranges[file_idx], "report");
                }
            }
            continue;
        }
        let flagged = (different == 0 && matches!(sel, 'A' | 'E' | 'X'))
            || (different == 2 && sel == 'A');
        let replace = (different == 3 && matches!(sel, 'A' | 'E' | 'e' | '3'))
            || (different == 0 && matches!(sel, 'e' | 'x'));
        if merge {
            emit_range(
                &mut out,
                0,
                Diff3Range {
                    start: cursor,
                    end: region.left.start,
                },
                "source",
            );
            if flagged {
                conflict = true;
                if different == 2 {
                    out.push_str(&format!("<<<<<<< {}\n", lbls[1]));
                    emit_range(&mut out, 1, base_r, "changed");
                } else {
                    out.push_str(&format!("<<<<<<< {}\n", lbls[0]));
                    emit_range(&mut out, 0, region.left, "changed");
                    if sel == 'A' {
                        out.push_str(&format!("||||||| {}\n", lbls[1]));
                        emit_range(&mut out, 1, base_r, "changed");
                    }
                }
                out.push_str("=======\n");
                emit_range(&mut out, 2, theirs_r, "changed");
                out.push_str(&format!(">>>>>>> {}\n", lbls[2]));
            } else if replace {
                emit_range(&mut out, 2, theirs_r, "changed");
            } else {
                emit_range(&mut out, 0, region.left, "source");
            }
            cursor = region.left.end;
        } else if replace {
            if theirs_r.start == theirs_r.end {
                if region.left.start != region.left.end {
                    let addr = address(region.left);
                    out.push_str(&format!("{}d\n", &addr[..addr.len() - 1]));
                }
            } else {
                out.push_str(&format!("{}\n", address(region.left)));
                let dots = emit_range(&mut out, 2, theirs_r, "ed");
                out.push_str(".\n");
                if dots {
                    let s = region.left.start + 1;
                    let e = region.left.start + (theirs_r.end - theirs_r.start);
                    if e > s {
                        out.push_str(&format!("{s},{e}s/^\\.//\n"));
                    } else {
                        out.push_str(&format!("{s}s/^\\.//\n"));
                    }
                }
            }
        } else if flagged {
            conflict = true;
            out.push_str(&format!("{}a\n", region.left.end));
            let mut dots = false;
            if different != 2 {
                if sel == 'A' {
                    out.push_str(&format!("||||||| {}\n", lbls[1]));
                    dots = emit_range(&mut out, 1, base_r, "ed");
                }
                out.push_str("=======\n");
                dots = emit_range(&mut out, 2, theirs_r, "ed") || dots;
            }
            out.push_str(&format!(">>>>>>> {}\n.\n", lbls[2]));
            if dots {
                let s = region.left.end + 2;
                let e = region.left.end + (base_r.end - base_r.start) + (theirs_r.end - theirs_r.start) + 2;
                out.push_str(&format!("{s},{e}s/^\\.//\n"));
            }
            out.push_str(&format!(
                "{}a\n<<<<<<< {}\n",
                region.left.start,
                lbls[if different == 2 { 1 } else { 0 }]
            ));
            if different == 2 {
                let base_dots = emit_range(&mut out, 1, base_r, "ed");
                out.push_str("=======\n.\n");
                if base_dots {
                    let s = region.left.start + 2;
                    let e = region.left.start + (base_r.end - base_r.start) + 1;
                    if e > s {
                        out.push_str(&format!("{s},{e}s/^\\.//\n"));
                    } else {
                        out.push_str(&format!("{s}s/^\\.//\n"));
                    }
                }
            } else {
                out.push_str(".\n");
            }
        }
    }

    if merge {
        emit_range(
            &mut out,
            0,
            Diff3Range {
                start: cursor,
                end: all_files[0].len(),
            },
            "source",
        );
    } else if !report && write_quit {
        out.push_str("w\nq\n");
    }

    BuiltinOutcome {
        stdout: out,
        stderr,
        exit_code: if merge && conflict { 1 } else { 0 },
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
