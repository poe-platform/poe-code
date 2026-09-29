use crate::cli::{CliResult, execute_git_cli};
use crate::commands::plumbing::get_config;
use crate::fs::MemoryFs;
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct HookOutput {
    pub ran: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl HookOutput {
    pub fn skipped() -> Self {
        Self {
            ran: false,
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
        }
    }
}

pub fn resolve_hook_path(fs: &MemoryFs, repo_root: &str, gitdir: &str, hook_name: &str) -> Option<String> {
    let hooks_dir = if let Some(cfg_path) = get_config(fs, gitdir, "core.hooksPath") {
        let cfg_str = cfg_path.as_str();
        let p = cfg_str.trim();
        if p.starts_with('/') {
            p.to_string()
        } else {
            format!("{repo_root}/{}", p.trim_start_matches("./"))
        }
    } else if let Some(common) = fs.read_str(&format!("{gitdir}/commondir")) {
        let c = common.trim();
        let common_dir = if c.starts_with('/') {
            c.to_string()
        } else {
            format!("{gitdir}/{c}")
        };
        format!("{common_dir}/hooks")
    } else {
        format!("{gitdir}/hooks")
    };

    let candidate = format!("{hooks_dir}/{hook_name}");
    if fs.exists(&candidate) && !fs.stat(&candidate).is_ok_and(|st| st.is_directory()) {
        Some(candidate)
    } else {
        None
    }
}

pub fn run_hook(
    fs: &MemoryFs,
    repo_root: &str,
    gitdir: &str,
    hook_name: &str,
    args: &[&str],
    stdin_data: Option<&str>,
) -> HookOutput {
    let Some(hook_path) = resolve_hook_path(fs, repo_root, gitdir, hook_name) else {
        return HookOutput::skipped();
    };
    let Some(script_content) = fs.read_str(&hook_path) else {
        return HookOutput::skipped();
    };
    if script_content.trim().is_empty() {
        return HookOutput::skipped();
    }

    let mut env = BTreeMap::new();
    env.insert("GIT_DIR".to_string(), gitdir.to_string());
    env.insert("GIT_WORK_TREE".to_string(), repo_root.to_string());
    env.insert("GIT_INDEX_FILE".to_string(), format!("{gitdir}/index"));
    env.insert("PWD".to_string(), repo_root.to_string());
    env.insert("0".to_string(), hook_path.clone());
    env.insert("#".to_string(), args.len().to_string());
    env.insert("@".to_string(), args.join(" "));
    env.insert("*".to_string(), args.join(" "));
    for (idx, a) in args.iter().enumerate() {
        env.insert((idx + 1).to_string(), (*a).to_string());
    }

    let mut stdout = String::new();
    let mut stderr = String::new();
    let stdin_lines: Vec<&str> = stdin_data.unwrap_or("").lines().collect();
    let mut stdin_cursor = 0usize;

    let lines: Vec<&str> = script_content.lines().collect();
    let exit_code = eval_script_lines(
        fs,
        repo_root,
        gitdir,
        &lines,
        &mut env,
        &stdin_lines,
        &mut stdin_cursor,
        &mut stdout,
        &mut stderr,
    );

    HookOutput {
        ran: true,
        exit_code,
        stdout,
        stderr,
    }
}

fn expand_vars(input: &str, env: &BTreeMap<String, String>, last_status: i32) -> String {
    let mut out = String::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '$' && i + 1 < chars.len() {
            if chars[i + 1] == '?' {
                out.push_str(&last_status.to_string());
                i += 2;
                continue;
            }
            if chars[i + 1] == '#' || chars[i + 1] == '@' || chars[i + 1] == '*' {
                let k = chars[i + 1].to_string();
                out.push_str(env.get(&k).map(String::as_str).unwrap_or(""));
                i += 2;
                continue;
            }
            if chars[i + 1] == '{'
                && let Some(end_rel) = chars[i + 2..].iter().position(|&c| c == '}') {
                    let key: String = chars[i + 2..i + 2 + end_rel].iter().collect();
                    out.push_str(env.get(&key).map(String::as_str).unwrap_or(""));
                    i += 3 + end_rel;
                    continue;
                }
            if chars[i + 1].is_ascii_alphanumeric() || chars[i + 1] == '_' {
                let mut j = i + 1;
                if chars[j].is_ascii_digit() {
                    j += 1;
                } else {
                    while j < chars.len() && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                        j += 1;
                    }
                }
                let key: String = chars[i + 1..j].iter().collect();
                out.push_str(env.get(&key).map(String::as_str).unwrap_or(""));
                i = j;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn split_unquoted_redirection(s: &str) -> Option<(String, String, bool)> {
    let chars: Vec<char> = s.chars().collect();
    let mut in_single = false;
    let mut in_double = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\\' && !in_single && i + 1 < chars.len() {
            i += 2;
            continue;
        }
        if c == '\'' && !in_double {
            in_single = !in_single;
            i += 1;
            continue;
        }
        if c == '"' && !in_single {
            in_double = !in_double;
            i += 1;
            continue;
        }
        if !in_single && !in_double && c == '>' {
            let left: String = chars[..i].iter().collect();
            if i + 1 < chars.len() && chars[i + 1] == '>' {
                let right: String = chars[i + 2..].iter().collect();
                return Some((left, right, true));
            } else {
                let right: String = chars[i + 1..].iter().collect();
                return Some((left, right, false));
            }
        }
        i += 1;
    }
    None
}

fn tokenize_shell(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\\' && !in_single && i + 1 < chars.len() {
            cur.push(chars[i + 1]);
            i += 2;
            continue;
        }
        if c == '\'' && !in_double {
            in_single = !in_single;
            i += 1;
            continue;
        }
        if c == '"' && !in_single {
            in_double = !in_double;
            i += 1;
            continue;
        }
        if c.is_ascii_whitespace() && !in_single && !in_double {
            if !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
            }
            i += 1;
            continue;
        }
        cur.push(c);
        i += 1;
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    tokens
}

fn resolve_fs_path(repo_root: &str, p: &str) -> String {
    if p.starts_with('/') {
        p.to_string()
    } else {
        format!("{repo_root}/{}", p.trim_start_matches("./"))
    }
}

fn eval_condition(
    fs: &MemoryFs,
    repo_root: &str,
    gitdir: &str,
    cond_str: &str,
    env: &mut BTreeMap<String, String>,
    stdin_lines: &[&str],
    stdin_cursor: &mut usize,
    stdout: &mut String,
    stderr: &mut String,
) -> bool {
    let mut s = cond_str.trim();
    if let Some(rest) = s.strip_suffix("; then") {
        s = rest.trim();
    }
    let mut negate = false;
    while let Some(rest) = s.strip_prefix('!') {
        negate = !negate;
        s = rest.trim();
    }
    let inner = if (s.starts_with('[') && s.ends_with(']'))
        || (s.starts_with("[[") && s.ends_with("]]"))
    {
        let stripped = s
            .trim_start_matches('[')
            .trim_end_matches(']')
            .trim();
        let expanded = expand_vars(stripped, env, 0);
        let toks = tokenize_shell(&expanded);
        eval_test_tokens(fs, repo_root, &toks)
    } else if let Some(rest) = s.strip_prefix("test ") {
        let expanded = expand_vars(rest.trim(), env, 0);
        let toks = tokenize_shell(&expanded);
        eval_test_tokens(fs, repo_root, &toks)
    } else {
        let mut sub_out = String::new();
        let mut sub_err = String::new();
        let code = eval_single_command(
            fs,
            repo_root,
            gitdir,
            s,
            env,
            stdin_lines,
            stdin_cursor,
            &mut sub_out,
            &mut sub_err,
            0,
        );
        stdout.push_str(&sub_out);
        stderr.push_str(&sub_err);
        code == Some(0) || code.is_none()
    };
    if negate { !inner } else { inner }
}

fn eval_test_tokens(fs: &MemoryFs, repo_root: &str, toks: &[String]) -> bool {
    if toks.is_empty() {
        return false;
    }
    if toks[0] == "!" {
        return !eval_test_tokens(fs, repo_root, &toks[1..]);
    }
    if toks.len() == 1 {
        return !toks[0].is_empty();
    }
    if toks.len() == 2 {
        let op = toks[0].as_str();
        let val = &toks[1];
        let p = resolve_fs_path(repo_root, val);
        return match op {
            "-z" => val.is_empty(),
            "-n" => !val.is_empty(),
            "-e" | "-f" => fs.exists(&p) && !fs.stat(&p).is_ok_and(|st| st.is_directory()),
            "-d" => fs.stat(&p).is_ok_and(|st| st.is_directory()),
            "-s" => fs.read(&p).map(|b| !b.is_empty()).unwrap_or(false),
            "-x" => fs.exists(&p),
            _ => false,
        };
    }
    if toks.len() >= 3 {
        let left = &toks[0];
        let op = toks[1].as_str();
        let right = &toks[2];
        return match op {
            "=" | "==" => left == right,
            "!=" => left != right,
            "-eq" => left.parse::<i64>().unwrap_or(0) == right.parse::<i64>().unwrap_or(0),
            "-ne" => left.parse::<i64>().unwrap_or(0) != right.parse::<i64>().unwrap_or(0),
            "-gt" => left.parse::<i64>().unwrap_or(0) > right.parse::<i64>().unwrap_or(0),
            "-ge" => left.parse::<i64>().unwrap_or(0) >= right.parse::<i64>().unwrap_or(0),
            "-lt" => left.parse::<i64>().unwrap_or(0) < right.parse::<i64>().unwrap_or(0),
            "-le" => left.parse::<i64>().unwrap_or(0) <= right.parse::<i64>().unwrap_or(0),
            _ => false,
        };
    }
    false
}

#[allow(clippy::too_many_arguments)]
fn eval_script_lines(
    fs: &MemoryFs,
    repo_root: &str,
    gitdir: &str,
    lines: &[&str],
    env: &mut BTreeMap<String, String>,
    stdin_lines: &[&str],
    stdin_cursor: &mut usize,
    stdout: &mut String,
    stderr: &mut String,
) -> i32 {
    let mut last_status = 0;
    let mut i = 0;
    while i < lines.len() {
        let raw_line = lines[i].trim();
        if raw_line.is_empty() || raw_line.starts_with('#') {
            i += 1;
            continue;
        }

        // Handle `if ...; then ... [else ...] fi`
        if raw_line.starts_with("if ") {
            let cond_part = raw_line.strip_prefix("if ").unwrap_or("").trim();
            let mut depth = 1usize;
            let mut else_idx = None;
            let mut fi_idx = lines.len();
            for (j, line) in lines.iter().enumerate().skip(i + 1) {
                let t = line.trim();
                if t.starts_with("if ") {
                    depth += 1;
                } else if t == "fi" || t.starts_with("fi ") || t.starts_with("fi;") {
                    depth -= 1;
                    if depth == 0 {
                        fi_idx = j;
                        break;
                    }
                } else if depth == 1 && (t == "else" || t.starts_with("else ")) {
                    else_idx = Some(j);
                }
            }
            let cond_ok = eval_condition(
                fs,
                repo_root,
                gitdir,
                cond_part,
                env,
                stdin_lines,
                stdin_cursor,
                stdout,
                stderr,
            );
            let branch_slice = if cond_ok {
                let end = else_idx.unwrap_or(fi_idx);
                &lines[i + 1..end]
            } else if let Some(e_idx) = else_idx {
                &lines[e_idx + 1..fi_idx]
            } else {
                &[][..]
            };
            let code = eval_script_lines(
                fs,
                repo_root,
                gitdir,
                branch_slice,
                env,
                stdin_lines,
                stdin_cursor,
                stdout,
                stderr,
            );
            if code != 0 && env.contains_key("__EARLY_EXIT__") {
                return code;
            }
            last_status = code;
            i = (fi_idx + 1).min(lines.len());
            continue;
        }

        // Handle `while read a b c ...; do ... done`
        if raw_line.starts_with("while ") {
            let mut done_idx = lines.len();
            let mut depth = 1usize;
            for (j, line) in lines.iter().enumerate().skip(i + 1) {
                let t = line.trim();
                if t.starts_with("while ") {
                    depth += 1;
                } else if t == "done" || t.starts_with("done ") {
                    depth -= 1;
                    if depth == 0 {
                        done_idx = j;
                        break;
                    }
                }
            }
            let cond_part = raw_line
                .strip_prefix("while ")
                .unwrap_or("")
                .trim_end_matches("; do")
                .trim_end_matches(" do")
                .trim();
            while eval_condition(
                fs,
                repo_root,
                gitdir,
                cond_part,
                env,
                stdin_lines,
                stdin_cursor,
                stdout,
                stderr,
            ) {
                let code = eval_script_lines(
                    fs,
                    repo_root,
                    gitdir,
                    &lines[i + 1..done_idx],
                    env,
                    stdin_lines,
                    stdin_cursor,
                    stdout,
                    stderr,
                );
                if env.contains_key("__EARLY_EXIT__") {
                    return code;
                }
                last_status = code;
            }
            i = (done_idx + 1).min(lines.len());
            continue;
        }

        if raw_line == "then" || raw_line == "do" || raw_line == "fi" || raw_line == "done" {
            i += 1;
            continue;
        }

        for sub_stmt in raw_line.split(';') {
            let stmt = sub_stmt.trim();
            if stmt.is_empty() || stmt == "then" || stmt == "do" {
                continue;
            }
            if let Some(exit_code) = eval_single_command(
                fs,
                repo_root,
                gitdir,
                stmt,
                env,
                stdin_lines,
                stdin_cursor,
                stdout,
                stderr,
                last_status,
            ) {
                if env.contains_key("__EARLY_EXIT__") {
                    return exit_code;
                }
                last_status = exit_code;
            }
        }
        i += 1;
    }
    last_status
}

#[allow(clippy::too_many_arguments)]
fn eval_single_command(
    fs: &MemoryFs,
    repo_root: &str,
    _gitdir: &str,
    stmt: &str,
    env: &mut BTreeMap<String, String>,
    stdin_lines: &[&str],
    stdin_cursor: &mut usize,
    stdout: &mut String,
    stderr: &mut String,
    last_status: i32,
) -> Option<i32> {
    let mut cmd_str = stmt.trim().to_string();
    let mut to_stderr = false;
    if cmd_str.ends_with(">&2") || cmd_str.ends_with("1>&2") {
        to_stderr = true;
        cmd_str = cmd_str
            .trim_end_matches("1>&2")
            .trim_end_matches(">&2")
            .trim()
            .to_string();
    }

    let mut redirect_append: Option<String> = None;
    let mut redirect_write: Option<String> = None;
    if let Some((left, right, is_append)) = split_unquoted_redirection(&cmd_str) {
        if is_append {
            redirect_append = Some(expand_vars(right.trim(), env, last_status));
        } else {
            redirect_write = Some(expand_vars(right.trim(), env, last_status));
        }
        cmd_str = left.trim().to_string();
    }

    // Command substitution $(git ...)
    while let Some(start) = cmd_str.find("$(") {
        if let Some(end_rel) = cmd_str[start + 2..].find(')') {
            let inner = &cmd_str[start + 2..start + 2 + end_rel];
            let mut sub_out = String::new();
            let mut sub_err = String::new();
            let _ = eval_single_command(
                fs,
                repo_root,
                _gitdir,
                inner,
                env,
                stdin_lines,
                stdin_cursor,
                &mut sub_out,
                &mut sub_err,
                last_status,
            );
            let replacement = sub_out.trim_end_matches('\n');
            cmd_str = format!(
                "{}{}{}",
                &cmd_str[..start],
                replacement,
                &cmd_str[start + 3 + end_rel..]
            );
        } else {
            break;
        }
    }

    let expanded = expand_vars(&cmd_str, env, last_status);
    let toks = tokenize_shell(&expanded);
    if toks.is_empty() {
        return None;
    }

    // Variable assignment VAR=val or export VAR=val
    if toks[0] == "export" && toks.len() >= 2 {
        if let Some((k, v)) = toks[1].split_once('=') {
            env.insert(k.to_string(), v.to_string());
        }
        return Some(0);
    }
    if toks.len() == 1
        && let Some((k, v)) = toks[0].split_once('=')
        && !k.is_empty()
        && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        env.insert(k.to_string(), v.to_string());
        return Some(0);
    }

    let mut local_out = String::new();
    let code = match toks[0].as_str() {
        "exit" => {
            let c = toks.get(1).and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
            env.insert("__EARLY_EXIT__".to_string(), c.to_string());
            return Some(c);
        }
        "true" | ":" => 0,
        "false" => 1,
        "read" => {
            let var_names: Vec<&str> = toks[1..]
                .iter()
                .map(String::as_str)
                .filter(|s| !s.starts_with('-'))
                .collect();
            if *stdin_cursor >= stdin_lines.len() {
                return Some(1);
            }
            let line = stdin_lines[*stdin_cursor];
            *stdin_cursor += 1;
            let parts: Vec<&str> = line.split_whitespace().collect();
            for (idx, &vname) in var_names.iter().enumerate() {
                if idx + 1 == var_names.len() && idx < parts.len() {
                    env.insert(vname.to_string(), parts[idx..].join(" "));
                } else {
                    env.insert(
                        vname.to_string(),
                        parts.get(idx).copied().unwrap_or("").to_string(),
                    );
                }
            }
            0
        }
        "echo" => {
            let mut start_idx = 1;
            let mut newline = true;
            if toks.get(1).map(String::as_str) == Some("-n") {
                newline = false;
                start_idx = 2;
            }
            local_out.push_str(&toks[start_idx..].join(" "));
            if newline {
                local_out.push('\n');
            }
            0
        }
        "printf" => {
            if let Some(fmt) = toks.get(1) {
                let mut rendered = fmt.replace("\\n", "\n").replace("\\t", "\t");
                for arg in &toks[2..] {
                    if let Some(pos) = rendered.find("%s") {
                        rendered.replace_range(pos..pos + 2, arg);
                    }
                }
                local_out.push_str(&rendered);
            }
            0
        }
        "cat" => {
            for f in &toks[1..] {
                let p = resolve_fs_path(repo_root, f);
                if let Some(content) = fs.read_str(&p) {
                    local_out.push_str(&content);
                }
            }
            0
        }
        "grep" => {
            let quiet = toks.iter().any(|t| t == "-q" || t == "--quiet");
            let invert = toks.iter().any(|t| t == "-v");
            let args_only: Vec<&str> = toks[1..]
                .iter()
                .map(String::as_str)
                .filter(|t| !t.starts_with('-'))
                .collect();
            if args_only.len() >= 2 {
                let pat = args_only[0];
                let file_p = resolve_fs_path(repo_root, args_only[1]);
                let content = fs.read_str(&file_p).unwrap_or_default();
                let mut matched = false;
                for line in content.lines() {
                    let line_match = regex::Regex::new(pat)
                        .map(|re| re.is_match(line))
                        .unwrap_or_else(|_| line.contains(pat));
                    let ok = if invert { !line_match } else { line_match };
                    if ok {
                        matched = true;
                        if !quiet {
                            local_out.push_str(line);
                            local_out.push('\n');
                        }
                    }
                }
                if matched { 0 } else { 1 }
            } else {
                1
            }
        }
        "touch" => {
            for f in &toks[1..] {
                if !f.starts_with('-') {
                    let p = resolve_fs_path(repo_root, f);
                    let existing = fs.read_str(&p).unwrap_or_default();
                    fs.write_str(&p, &existing);
                }
            }
            0
        }
        "rm" => {
            for f in &toks[1..] {
                if !f.starts_with('-') {
                    let p = resolve_fs_path(repo_root, f);
                    let _ = fs.rm(&p);
                }
            }
            0
        }
        "git" => {
            let git_args: Vec<&str> = toks[1..].iter().map(String::as_str).collect();
            let CliResult {
                exit_code,
                stdout: g_out,
                stderr: g_err,
                ..
            } = execute_git_cli(fs, repo_root, &git_args);
            local_out.push_str(&g_out);
            stderr.push_str(&g_err);
            exit_code
        }
        "[" | "[[" | "test" => {
            let inner_toks: Vec<String> = toks[1..]
                .iter()
                .filter(|s| *s != "]" && *s != "]]")
                .cloned()
                .collect();
            if eval_test_tokens(fs, repo_root, &inner_toks) {
                0
            } else {
                1
            }
        }
        _ => 0,
    };

    if let Some(append_target) = redirect_append {
        let p = resolve_fs_path(repo_root, append_target.trim_matches('"').trim_matches('\''));
        let prev = fs.read_str(&p).unwrap_or_default();
        fs.write_str(&p, &format!("{prev}{local_out}"));
    } else if let Some(write_target) = redirect_write {
        let p = resolve_fs_path(repo_root, write_target.trim_matches('"').trim_matches('\''));
        fs.write_str(&p, &local_out);
    } else if to_stderr {
        stderr.push_str(&local_out);
    } else {
        stdout.push_str(&local_out);
    }

    Some(code)
}
