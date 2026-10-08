use crate::shell::builtins::BuiltinOutcome;
use crate::shell::expand::decode_ansi_c_escapes;
use crate::vfs::{
    SafeBashFs, dirname_posix_path, normalize_posix_path, resolve_posix_path, stream_string_to_bytes,
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
    match cmd {
        "cat" => Some(cmd_cat(args, stdin, cwd, fs)),
        "head" => Some(cmd_head(args, stdin, cwd, fs)),
        "tail" => Some(cmd_tail(args, stdin, cwd, fs)),
        "wc" => Some(cmd_wc(args, stdin, cwd, env, fs)),
        "sort" => Some(cmd_sort(args, stdin, cwd, env, fs)),
        "uniq" => Some(cmd_uniq(args, stdin, cwd, env, fs)),
        "cut" => Some(cmd_cut(args, stdin, cwd, env, fs)),
        "tr" => Some(cmd_tr(args, stdin)),
        "nl" => Some(cmd_nl(args, stdin, cwd, fs)),
        "tac" => Some(cmd_tac(args, stdin, cwd, fs)),
        "rev" => Some(cmd_rev(args, stdin, cwd, env, fs)),
        "paste" => Some(cmd_paste(args, stdin, cwd, fs)),
        "join" => Some(cmd_join(args, stdin, cwd, fs)),
        "comm" => Some(cmd_comm(args, stdin, cwd, fs)),
        "getopt" => Some(cmd_getopt(args)),
        "dos2unix" => Some(cmd_dos2unix(args, stdin, cwd, fs, false)),
        "unix2dos" => Some(cmd_dos2unix(args, stdin, cwd, fs, true)),
        "iconv" => Some(cmd_iconv(args, stdin, cwd, fs)),
        "tee" => Some(cmd_tee(args, stdin, cwd, fs)),
        "sponge" => Some(cmd_sponge(args, stdin, cwd, fs)),
        "seq" => Some(cmd_seq(args)),
        "yes" => Some(cmd_yes(args)),
        "basename" => Some(cmd_basename(args)),
        "dirname" => Some(cmd_dirname(args)),
        "env" | "printenv" => Some(cmd_printenv(args, env)),
        "envsubst" => Some(cmd_envsubst(args, stdin, env)),
        "date" => Some(cmd_date(args)),
        "cal" => Some(cmd_cal(args, env)),
        "getconf" => Some(cmd_getconf(args, cwd, fs)),
        "locale" => Some(cmd_locale(args, env)),
        "less" | "more" => Some(cmd_less_more(cmd, args, stdin, cwd, fs)),
        "pathchk" => Some(cmd_pathchk(args, cwd, fs)),
        "expr" => Some(cmd_expr(args)),
        "bc" => Some(cmd_bc(args, stdin, cwd, fs)),
        "numfmt" => Some(cmd_numfmt(args, stdin)),
        "uname" => Some(cmd_uname(args, env, fs)),
        "whoami" => Some(ok_out(&format!(
            "{}\n",
            env.get("USER").map(|s| s.as_str()).unwrap_or("e2e")
        ))),
        "hostname" => Some(cmd_hostname(args, env, fs)),
        "nproc" => Some(cmd_nproc(args, env)),
        "id" => Some(cmd_id(args, env, fs)),
        "sleep" => Some(ok_out("")),
        "factor" => Some(cmd_factor(args, stdin)),
        "expand" => Some(cmd_expand(args, stdin, cwd, fs)),
        "unexpand" => Some(cmd_unexpand(args, stdin, cwd, fs)),
        "tsort" => Some(cmd_tsort(args, stdin, cwd, env, fs)),
        "truncate" => Some(cmd_truncate(args, cwd, fs)),
        "fold" => Some(cmd_fold(args, stdin, cwd, env, fs)),
        "fmt" => Some(cmd_fmt(args, stdin, cwd, fs)),
        "csplit" => Some(cmd_csplit(args, stdin, cwd, fs)),
        "pr" => Some(cmd_pr(args, stdin, cwd, fs)),
        "column" => Some(cmd_column(args, stdin, cwd, fs)),
        "shuf" => Some(cmd_shuf(args, stdin, cwd, fs)),
        "split" => Some(cmd_split(args, stdin, cwd, env, fs)),
        "dd" => Some(cmd_dd(args, stdin, cwd, fs)),
        "install" => Some(cmd_install(args, cwd, fs)),
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

fn cmd_cat(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut flag_n = false;
    let mut flag_b = false;
    let mut flag_s = false;
    let mut flag_e_ends = false;
    let mut flag_t_tabs = false;
    let mut flag_v = false;
    let mut files = Vec::new();
    let mut opts_done = false;

    for arg in args {
        if !opts_done && arg == "--" {
            opts_done = true;
            continue;
        }
        if !opts_done && arg == "--help" {
            return ok_out("Usage: cat [OPTION]... [FILE]...\n");
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

    let mut raw_bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut exit_code = 0;
    let targets = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };
    for f in &targets {
        if f == "-" {
            raw_bytes.extend_from_slice(&stream_string_to_bytes(stdin));
        } else {
            let p = resolve_posix_path(cwd, f);
            if let Ok(st) = fs.stat(&p)
                && st.kind == crate::vfs::VfsEntryKind::Directory
            {
                stderr.push_str(&format!("cat: {f}: Is a directory\n"));
                exit_code = 1;
                continue;
            }
            match fs.read_file(&p) {
                Ok(bytes) => raw_bytes.extend_from_slice(&bytes),
                Err(e) => {
                    stderr.push_str(&format!("cat: {f}: {e}\n"));
                    exit_code = 1;
                }
            }
        }
    }

    if !flag_n && !flag_b && !flag_s && !flag_e_ends && !flag_t_tabs && !flag_v {
        return BuiltinOutcome {
            stdout: crate::vfs::bytes_to_stream_string(&raw_bytes),
            stderr,
            exit_code,
        };
    }

    let show_ends_only_cr = flag_e_ends && !flag_v;
    let mut line_start = true;
    let mut blank_count = 0usize;
    let mut number = 1usize;
    let mut pending_cr = false;
    let mut out_bytes: Vec<u8> = Vec::with_capacity(raw_bytes.len());

    for &byte in &raw_bytes {
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
    }
    if pending_cr {
        out_bytes.push(13);
    }

    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        stderr,
        exit_code,
    }
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

fn head_tail_count(amount: &str) -> Result<usize, String> {
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
    if total > (usize::MAX as u128) {
        return Err(format!("invalid number '{amount}'"));
    }
    Ok(total as usize)
}

fn split_records_inclusive(raw: &[u8], delimiter: u8) -> Vec<&[u8]> {
    if raw.is_empty() {
        return Vec::new();
    }
    let mut records = Vec::new();
    let mut start = 0usize;
    for (idx, &b) in raw.iter().enumerate() {
        if b == delimiter {
            records.push(&raw[start..=idx]);
            start = idx + 1;
        }
    }
    if start < raw.len() {
        records.push(&raw[start..]);
    }
    records
}

fn run_head_or_tail(
    name: &str,
    raw_args: &[String],
    stdin: &str,
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

    for file in &names {
        let raw_bytes: Vec<u8> = if file == "-" {
            stream_string_to_bytes(stdin)
        } else {
            let p = resolve_posix_path(cwd, file);
            match fs.stat(&p) {
                Ok(st) => {
                    if st.kind == crate::vfs::VfsEntryKind::Directory {
                        stderr.push_str(&format!("{name}: {file}: Is a directory\n"));
                        exit_code = 1;
                        continue;
                    }
                }
                Err(e) => {
                    stderr.push_str(&format!("{name}: {file}: {e}\n"));
                    exit_code = 1;
                    continue;
                }
            }
            match fs.read_file(&p) {
                Ok(b) => b,
                Err(e) => {
                    stderr.push_str(&format!("{name}: {file}: {e}\n"));
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

        if name == "head" {
            if bytes_mode {
                let take = if negative {
                    raw_bytes.len().saturating_sub(count)
                } else {
                    count.min(raw_bytes.len())
                };
                out_bytes.extend_from_slice(&raw_bytes[..take]);
            } else {
                let records = split_records_inclusive(&raw_bytes, delimiter);
                let take = if negative {
                    records.len().saturating_sub(count)
                } else {
                    count.min(records.len())
                };
                for rec in &records[..take] {
                    out_bytes.extend_from_slice(rec);
                }
            }
        } else if bytes_mode {
            let start = if positive {
                count.saturating_sub(1).min(raw_bytes.len())
            } else {
                raw_bytes.len().saturating_sub(count)
            };
            out_bytes.extend_from_slice(&raw_bytes[start..]);
        } else {
            let records = split_records_inclusive(&raw_bytes, delimiter);
            let start = if positive {
                count.saturating_sub(1).min(records.len())
            } else {
                records.len().saturating_sub(count)
            };
            for rec in &records[start..] {
                out_bytes.extend_from_slice(rec);
            }
        }
    }

    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        stderr,
        exit_code,
    }
}

fn cmd_head(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    run_head_or_tail("head", args, stdin, cwd, fs)
}

fn cmd_tail(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    run_head_or_tail("tail", args, stdin, cwd, fs)
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

fn wc_ranges_contains(ranges: &[(u32, u32)], point: u32) -> bool {
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
    stdin: &str,
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
            stream_string_to_bytes(stdin)
        } else {
            let p = resolve_posix_path(cwd, f0);
            match fs.read_file(&p) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("wc: {f0}: {e}\n"), 1),
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

    let zero_ranges = decode_wc_ranges(WC_ZERO_WIDTH_PACKED);
    let wide_ranges = decode_wc_ranges(WC_WIDE_PACKED);
    let display_width = |point: u32| -> usize {
        if (0x20..=0x7e).contains(&point) {
            return 1;
        }
        if wc_ranges_contains(&zero_ranges, point) {
            return 0;
        }
        if wc_ranges_contains(&wide_ranges, point) {
            2
        } else {
            1
        }
    };

    let count_bytes = |bytes: &[u8]| -> (usize, usize, usize, usize, usize) {
        let c = bytes.len();
        if single_byte {
            let mut l = 0usize;
            let mut w = 0usize;
            let m = c;
            let mut max_l = 0usize;
            let mut columns = 0usize;
            let mut in_word = false;
            for &byte in bytes {
                if byte == 10 {
                    l += 1;
                    in_word = false;
                    if columns > max_l {
                        max_l = columns;
                    }
                    columns = 0;
                } else if byte == 32 || (9..=13).contains(&byte) {
                    in_word = false;
                    if byte == 9 {
                        columns += 8 - (columns & 7);
                    } else if byte == 13 || byte == 12 {
                        if columns > max_l {
                            max_l = columns;
                        }
                        columns = 0;
                    } else if byte == 32 {
                        columns += 1;
                    }
                } else if (33..127).contains(&byte) {
                    if !in_word {
                        w += 1;
                        in_word = true;
                    }
                    columns += 1;
                }
            }
            if columns > max_l {
                max_l = columns;
            }
            (l, w, m, c, max_l)
        } else {
            let l = bytes.iter().filter(|&&b| b == 10).count();
            let mut w = 0usize;
            let mut m = 0usize;
            let mut max_l = 0usize;
            let mut columns = 0usize;
            let mut in_word = false;

            let mut consume_point = |point_opt: Option<u32>| {
                if let Some(point) = point_opt {
                    m += 1;
                    let is_ws = wc_space(point, posix);
                    let is_pr = point >= 32 && !(127..160).contains(&point);
                    if is_ws {
                        in_word = false;
                    } else if is_pr && !in_word {
                        w += 1;
                        in_word = true;
                    }
                    if point == 10 || point == 13 || point == 12 {
                        if columns > max_l {
                            max_l = columns;
                        }
                        columns = 0;
                    } else if point == 9 {
                        columns += 8 - (columns % 8);
                    } else {
                        columns += display_width(point);
                    }
                }
            };

            let mut remaining = 0u8;
            let mut point = 0u32;
            let mut lead = 0u8;
            let mut first = false;
            let mut idx = 0usize;
            while idx < bytes.len() {
                let byte = bytes[idx];
                if remaining > 0 {
                    let invalid = !(0x80..=0xbf).contains(&byte)
                        || (first
                            && ((lead == 0xe0 && byte < 0xa0)
                                || (lead == 0xed && byte >= 0xa0)
                                || (lead == 0xf0 && byte < 0x90)
                                || (lead == 0xf4 && byte >= 0x90)));
                    first = false;
                    if invalid {
                        remaining = 0;
                        consume_point(None);
                        continue;
                    }
                    point = (point << 6) | ((byte & 0x3f) as u32);
                    remaining -= 1;
                    if remaining == 0 {
                        consume_point(Some(point));
                    }
                } else if byte < 0x80 {
                    consume_point(Some(byte as u32));
                } else if (0xc2..=0xf4).contains(&byte) {
                    lead = byte;
                    remaining = if byte < 0xe0 {
                        1
                    } else if byte < 0xf0 {
                        2
                    } else {
                        3
                    };
                    point = (byte
                        & if remaining == 1 {
                            0x1f
                        } else if remaining == 2 {
                            0x0f
                        } else {
                            0x07
                        }) as u32;
                    first = true;
                } else {
                    consume_point(None);
                }
                idx += 1;
            }
            if remaining > 0 {
                consume_point(None);
            }
            if columns > max_l {
                max_l = columns;
            }
            (l, w, m, c, max_l)
        }
    };

    let format_counts =
        |l: usize, w: usize, m: usize, c: usize, max_l: usize, label: Option<&str>| -> String {
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
    let mut tot = (0usize, 0usize, 0usize, 0usize, 0usize);

    for name in &names {
        let label = if has_operands { Some(name.as_str()) } else { None };
        let raw_res: Result<Vec<u8>, String> = if name == "-" {
            Ok(stream_string_to_bytes(stdin))
        } else {
            let p = resolve_posix_path(cwd, name);
            match fs.stat(&p) {
                Ok(st) if st.kind == crate::vfs::VfsEntryKind::Directory => {
                    stderr.push_str(&format!("wc: {name}: Is a directory\n"));
                    exit_code = 1;
                    if total_mode != "only" {
                        out.push_str(&format_counts(0, 0, 0, 0, 0, label));
                    }
                    continue;
                }
                _ => {}
            }
            fs.read_file(&p)
        };
        match raw_res {
            Ok(bytes) => {
                let (l, w, m, c, max_l) = count_bytes(&bytes);
                tot.0 += l;
                tot.1 += w;
                tot.2 += m;
                tot.3 += c;
                tot.4 = tot.4.max(max_l);
                if total_mode != "only" {
                    out.push_str(&format_counts(l, w, m, c, max_l, label));
                }
            }
            Err(e) => {
                stderr.push_str(&format!("wc: {name}: {e}\n"));
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

pub(crate) fn parse_leading_f64(s: &str) -> f64 {
    let trimmed = s.trim();
    let mut num_end = 0usize;
    for (idx, ch) in trimmed.char_indices() {
        if ch.is_ascii_digit() || ch == '.' || (idx == 0 && (ch == '+' || ch == '-')) {
            num_end = idx + ch.len_utf8();
        } else {
            break;
        }
    }
    if num_end == 0 {
        0.0
    } else {
        trimmed[..num_end].parse::<f64>().unwrap_or(0.0)
    }
}

#[derive(Clone, Debug)]
struct SortNumericValue {
    whole: Vec<u8>,
    fraction: Vec<u8>,
    negative: bool,
    suffix_rank: usize,
}

fn parse_sort_numeric(bytes: &[u8], human: bool) -> SortNumericValue {
    let len = bytes.len();
    let mut i = 0usize;
    while i < len && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }
    let mut neg = false;
    if i < len && bytes[i] == b'-' {
        neg = true;
        i += 1;
    }
    let mut whole_start = i;
    while whole_start < len && bytes[whole_start] == b'0' {
        whole_start += 1;
    }
    let mut whole_end = whole_start;
    while whole_end < len && bytes[whole_end].is_ascii_digit() {
        whole_end += 1;
    }
    i = whole_end;
    let mut frac_start = 0usize;
    let mut frac_end = 0usize;
    if i < len && bytes[i] == b'.' {
        i += 1;
        frac_start = i;
        while i < len && bytes[i].is_ascii_digit() {
            i += 1;
        }
        frac_end = i;
        while frac_end > frac_start && bytes[frac_end - 1] == b'0' {
            frac_end -= 1;
        }
    }
    let whole = if whole_end > whole_start {
        bytes[whole_start..whole_end].to_vec()
    } else {
        vec![b'0']
    };
    let fraction = if frac_end > frac_start {
        bytes[frac_start..frac_end].to_vec()
    } else {
        Vec::new()
    };
    let nonzero = whole.as_slice() != b"0" || !fraction.is_empty();
    let suffix_rank = if human && nonzero && i < len {
        let s = if bytes[i] == b'k' { b'K' } else { bytes[i] };
        b"KMGTPEZYRQ"
            .iter()
            .position(|&c| c == s)
            .map(|p| p + 1)
            .unwrap_or(0)
    } else {
        0
    };
    SortNumericValue {
        whole,
        fraction,
        negative: neg && nonzero,
        suffix_rank,
    }
}

fn compare_sort_numeric(first: &SortNumericValue, second: &SortNumericValue) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    if first.negative != second.negative {
        return if first.negative {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }
    let mut compared = first.suffix_rank.cmp(&second.suffix_rank);
    if compared == Ordering::Equal {
        compared = first.whole.len().cmp(&second.whole.len());
    }
    if compared == Ordering::Equal {
        compared = first.whole.cmp(&second.whole);
    }
    if compared == Ordering::Equal {
        let width = first.fraction.len().max(second.fraction.len());
        for idx in 0..width {
            let a = first.fraction.get(idx).copied().unwrap_or(b'0');
            let b = second.fraction.get(idx).copied().unwrap_or(b'0');
            compared = a.cmp(&b);
            if compared != Ordering::Equal {
                break;
            }
        }
    }
    if first.negative {
        compared.reverse()
    } else {
        compared
    }
}

fn sort_general_numeric_value(bytes: &[u8]) -> (u8, f64) {
    let mut start = 0usize;
    while start < bytes.len() && (bytes[start] == b' ' || (9..=13).contains(&bytes[start])) {
        start += 1;
    }
    let sub = &bytes[start..];
    if sub.is_empty() {
        return (0, 0.0);
    }
    let mut lower = Vec::with_capacity(sub.len());
    for &b in sub {
        lower.push(b.to_ascii_lowercase());
    }
    let neg = lower[0] == b'-';
    let unsigned = if lower[0] == b'+' || lower[0] == b'-' {
        &lower[1..]
    } else {
        &lower[..]
    };
    if unsigned.starts_with(b"nan") {
        return (1, 0.0);
    }
    if unsigned.starts_with(b"inf") {
        return (2, if neg { f64::NEG_INFINITY } else { f64::INFINITY });
    }
    if unsigned.starts_with(b"0x") {
        let mut offset = 2usize;
        let mut value = 0.0f64;
        let mut scale = 1.0f64;
        let mut fractional = false;
        let mut digits = 0usize;
        while offset < unsigned.len() {
            let ch = unsigned[offset];
            if ch == b'.' && !fractional {
                fractional = true;
                offset += 1;
                continue;
            }
            let digit = match ch {
                b'0'..=b'9' => Some((ch - b'0') as f64),
                b'a'..=b'f' => Some((ch - b'a' + 10) as f64),
                _ => None,
            };
            let Some(d) = digit else {
                break;
            };
            digits += 1;
            if fractional {
                scale /= 16.0;
                value += d * scale;
            } else {
                value = value * 16.0 + d;
            }
            offset += 1;
        }
        if digits > 0 {
            if offset < unsigned.len() && unsigned[offset] == b'p' {
                let exp_slice = &unsigned[offset + 1..];
                let mut exp_end = 0usize;
                if exp_end < exp_slice.len() && (exp_slice[0] == b'+' || exp_slice[0] == b'-') {
                    exp_end += 1;
                }
                let exp_digits_start = exp_end;
                while exp_end < exp_slice.len() && exp_slice[exp_end].is_ascii_digit() {
                    exp_end += 1;
                }
                if exp_end > exp_digits_start
                    && let Ok(exp_str) = std::str::from_utf8(&exp_slice[..exp_end])
                    && let Ok(exp) = exp_str.parse::<i32>()
                    && value != 0.0
                {
                    value *= 2.0f64.powi(exp);
                }
            }
            return (2, if neg { -value } else { value });
        }
    }
    let mut end = 0usize;
    if end < lower.len() && (lower[0] == b'+' || lower[0] == b'-') {
        end += 1;
    }
    let mut has_digits = false;
    while end < lower.len() && lower[end].is_ascii_digit() {
        has_digits = true;
        end += 1;
    }
    if end < lower.len() && lower[end] == b'.' {
        end += 1;
        while end < lower.len() && lower[end].is_ascii_digit() {
            has_digits = true;
            end += 1;
        }
    }
    if has_digits && end < lower.len() && lower[end] == b'e' {
        let mut e_end = end + 1;
        if e_end < lower.len() && (lower[e_end] == b'+' || lower[e_end] == b'-') {
            e_end += 1;
        }
        let e_digits = e_end;
        while e_end < lower.len() && lower[e_end].is_ascii_digit() {
            e_end += 1;
        }
        if e_end > e_digits {
            end = e_end;
        }
    }
    if has_digits
        && let Ok(s) = std::str::from_utf8(&lower[..end])
        && let Ok(v) = s.parse::<f64>()
        && !v.is_nan()
    {
        return (2, v);
    }
    (0, 0.0)
}

fn parse_month_sort_bytes(bytes: &[u8]) -> u8 {
    let mut offset = 0usize;
    while offset < bytes.len() && (bytes[offset] == b' ' || bytes[offset] == b'\t') {
        offset += 1;
    }
    if offset + 3 > bytes.len() {
        return 0;
    }
    let m = [
        bytes[offset].to_ascii_uppercase(),
        bytes[offset + 1].to_ascii_uppercase(),
        bytes[offset + 2].to_ascii_uppercase(),
    ];
    match &m {
        b"JAN" => 1,
        b"FEB" => 2,
        b"MAR" => 3,
        b"APR" => 4,
        b"MAY" => 5,
        b"JUN" => 6,
        b"JUL" => 7,
        b"AUG" => 8,
        b"SEP" => 9,
        b"OCT" => 10,
        b"NOV" => 11,
        b"DEC" => 12,
        _ => 0,
    }
}

fn sort_version_order(byte: Option<u8>) -> i32 {
    match byte {
        Some(b'~') => -1,
        None | Some(b'0'..=b'9') => 0,
        Some(b) if b.is_ascii_alphabetic() => b as i32,
        Some(b) => (b as i32) + 256,
    }
}

fn compare_version_parts_bytes(left: &[u8], right: &[u8]) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let mut first = 0usize;
    let mut second = 0usize;
    let is_digit = |b: Option<u8>| matches!(b, Some(b'0'..=b'9'));
    while first < left.len() || second < right.len() {
        while (first < left.len() && !is_digit(left.get(first).copied()))
            || (second < right.len() && !is_digit(right.get(second).copied()))
        {
            let diff = sort_version_order(left.get(first).copied())
                - sort_version_order(right.get(second).copied());
            if diff != 0 {
                return if diff < 0 {
                    Ordering::Less
                } else {
                    Ordering::Greater
                };
            }
            if first < left.len() {
                first += 1;
            }
            if second < right.len() {
                second += 1;
            }
        }
        while left.get(first) == Some(&b'0') {
            first += 1;
        }
        while right.get(second) == Some(&b'0') {
            second += 1;
        }
        let mut difference: i32 = 0;
        while is_digit(left.get(first).copied()) && is_digit(right.get(second).copied()) {
            if difference == 0 {
                difference = (left[first] as i32) - (right[second] as i32);
            }
            first += 1;
            second += 1;
        }
        if is_digit(left.get(first).copied()) {
            return Ordering::Greater;
        }
        if is_digit(right.get(second).copied()) {
            return Ordering::Less;
        }
        if difference != 0 {
            return if difference < 0 {
                Ordering::Less
            } else {
                Ordering::Greater
            };
        }
    }
    Ordering::Equal
}

fn sort_version_prefix(bytes: &[u8]) -> &[u8] {
    let mut matched = bytes.len();
    let mut read_alpha = false;
    let start = if bytes.first() == Some(&b'.') { 1 } else { 0 };
    for (idx, &byte) in bytes.iter().enumerate().skip(start) {
        let alpha = byte == b'~' || byte.is_ascii_alphabetic();
        if read_alpha {
            read_alpha = false;
            if !alpha {
                matched = bytes.len();
            }
        } else if byte == b'.' {
            read_alpha = true;
            if matched == bytes.len() {
                matched = idx;
            }
        } else if !(alpha || byte.is_ascii_digit()) {
            matched = bytes.len();
        }
    }
    &bytes[..if read_alpha { bytes.len() } else { matched }]
}

fn compare_version_bytes(left: &[u8], right: &[u8]) -> std::cmp::Ordering {
    let special = |bytes: &[u8]| -> i32 {
        if bytes.is_empty() {
            0
        } else if bytes[0] != b'.' {
            4
        } else if bytes.len() == 1 {
            1
        } else if bytes.len() == 2 && bytes[1] == b'.' {
            2
        } else {
            3
        }
    };
    let s_cmp = special(left).cmp(&special(right));
    if s_cmp != std::cmp::Ordering::Equal {
        return s_cmp;
    }
    let pref_cmp = compare_version_parts_bytes(sort_version_prefix(left), sort_version_prefix(right));
    if pref_cmp != std::cmp::Ordering::Equal {
        return pref_cmp;
    }
    compare_version_parts_bytes(left, right)
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
    let parse_pos = |offset: &mut usize, min_val: usize| -> Result<usize, String> {
        let begin = *offset;
        while *offset < bytes.len() && bytes[*offset].is_ascii_digit() {
            *offset += 1;
        }
        if *offset == begin {
            return Err(format!("sort: invalid key '{specification}'\n"));
        }
        let val = specification[begin..*offset]
            .parse::<usize>()
            .map_err(|_| format!("sort: invalid key '{specification}'\n"))?;
        if val < min_val {
            return Err(format!("sort: invalid key '{specification}'\n"));
        }
        Ok(val)
    };
    let mut flags = BTreeSet::new();
    let parse_endpoint = |offset: &mut usize,
                          min_char: usize,
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

fn extract_sort_key_bytes<'a>(
    line: &'a [u8],
    key: &SortKey,
    separator: Option<u8>,
    global_blanks: bool,
) -> &'a [u8] {
    let mut fields: Vec<(usize, usize)> = Vec::new();
    if let Some(sep) = separator {
        let mut start = 0usize;
        for offset in 0..=line.len() {
            if offset == line.len() || line[offset] == sep {
                fields.push((start, offset));
                start = offset + 1;
            }
        }
    } else {
        let mut offset = 0usize;
        while offset < line.len() {
            let leading = offset;
            while offset < line.len() && (line[offset] == b' ' || line[offset] == b'\t') {
                offset += 1;
            }
            let start = leading;
            while offset < line.len() && line[offset] != b' ' && line[offset] != b'\t' {
                offset += 1;
            }
            fields.push((start, offset));
        }
    }
    let field_start = |field: Option<(usize, usize)>, skip_blanks: bool| -> usize {
        let (mut offset, end) = field.unwrap_or((line.len(), line.len()));
        if skip_blanks {
            while offset < end && (line[offset] == b' ' || line[offset] == b'\t') {
                offset += 1;
            }
        }
        offset
    };
    let inherit_blanks = key.flags.is_empty() && global_blanks;
    let start = field_start(
        fields.get(key.start - 1).copied(),
        key.start_blanks || inherit_blanks,
    ) + key.start_character
        - 1;
    let last = key.end.and_then(|e| fields.get(e - 1).copied());
    let end = match key.end {
        None => line.len(),
        Some(_) => match last {
            None => line.len(),
            Some(lf) => match key.end_character {
                None => lf.1,
                Some(ec) => (field_start(Some(lf), key.end_blanks || inherit_blanks) + ec).min(line.len()),
            },
        },
    };
    let s = start.min(line.len());
    let e = end.max(s).min(line.len());
    &line[s..e]
}

fn cmd_sort(
    args: &[String],
    stdin: &str,
    cwd: &str,
    _env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut flags: BTreeSet<char> = BTreeSet::new();
    let mut raw_sep: Option<String> = None;
    let mut out_file: Option<String> = None;
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
                    return err_out("sort: option requires an argument -- 't'\n", 2);
                }
                raw_sep = Some(args[i + 1].clone());
                i += 1;
            } else if let Some(v) = a.strip_prefix("--field-separator=") {
                raw_sep = Some(v.to_string());
            } else if a == "--key" {
                if i + 1 >= args.len() {
                    return err_out("sort: option requires an argument -- 'k'\n", 2);
                }
                key_specs.push(args[i + 1].clone());
                i += 1;
            } else if let Some(v) = a.strip_prefix("--key=") {
                key_specs.push(v.to_string());
            } else if a == "--output" {
                if i + 1 >= args.len() {
                    return err_out("sort: option requires an argument -- 'o'\n", 2);
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
            } else if a == "--buffer-size"
                || a == "--max-input-bytes"
                || a == "--max-records"
                || a == "--batch-size"
            {
                if i + 1 >= args.len() {
                    return err_out(&format!("sort: option '{a}' requires an argument\n"), 2);
                }
                i += 1;
            } else if a.starts_with("--buffer-size=")
                || a.starts_with("--max-input-bytes=")
                || a.starts_with("--max-records=")
                || a.starts_with("--batch-size=")
            {
                // Accepted resource flags
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
            return Err("sort: incompatible sort options\n".to_string());
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

    let mut per_file_records: Vec<Vec<Vec<u8>>> = Vec::with_capacity(names.len());
    for name in &names {
        let raw = if name == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let path = resolve_posix_path(cwd, name);
            if fs.is_dir(&path) {
                return err_out(&format!("sort: read failed: {name}: Is a directory\n"), 2);
            }
            match fs.read_file(&path) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("sort: cannot read: {name}: {e}\n"), 2),
            }
        };
        if raw.is_empty() {
            per_file_records.push(Vec::new());
            continue;
        }
        let mut recs: Vec<Vec<u8>> = Vec::new();
        let mut start = 0usize;
        for (idx, &b) in raw.iter().enumerate() {
            if b == delim_byte {
                recs.push(raw[start..idx].to_vec());
                start = idx + 1;
            }
        }
        if start < raw.len() {
            recs.push(raw[start..].to_vec());
        }
        per_file_records.push(recs);
    }

    let simple = keys.is_empty()
        && !['b', 'f', 'h', 'n', 'g', 'M', 'V', 'd', 'i']
            .iter()
            .any(|f| flags.contains(f));
    let global_rev = flags.contains(&'r');
    let stable = flags.contains(&'s');
    let unique = flags.contains(&'u');

    let transform_slice = |slice: &[u8], fset: &BTreeSet<char>, is_unkeyed: bool| -> Vec<u8> {
        let mut start = 0usize;
        if is_unkeyed && fset.contains(&'b') {
            while start < slice.len() && (slice[start] == b' ' || slice[start] == b'\t') {
                start += 1;
            }
        }
        let sub = &slice[start..];
        let mut out = Vec::with_capacity(sub.len());
        let has_d = fset.contains(&'d');
        let has_i = fset.contains(&'i');
        let has_f = fset.contains(&'f');
        for &b in sub {
            if has_d {
                if !(b == b'\t' || b == b' ' || b.is_ascii_alphanumeric()) {
                    continue;
                }
            } else if has_i && !(32..=126).contains(&b) {
                continue;
            }
            out.push(if has_f { b.to_ascii_uppercase() } else { b });
        }
        out
    };

    let compare_single_key =
        |first_raw: &[u8], second_raw: &[u8], fset: &BTreeSet<char>, is_unkeyed: bool| -> std::cmp::Ordering {
            let first = transform_slice(first_raw, fset, is_unkeyed);
            let second = transform_slice(second_raw, fset, is_unkeyed);
            let ord = if fset.contains(&'g') {
                let a = sort_general_numeric_value(&first);
                let b = sort_general_numeric_value(&second);
                a.0.cmp(&b.0)
                    .then_with(|| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            } else if fset.contains(&'M') {
                parse_month_sort_bytes(&first).cmp(&parse_month_sort_bytes(&second))
            } else if fset.contains(&'V') {
                compare_version_bytes(&first, &second)
            } else if fset.contains(&'n') || fset.contains(&'h') {
                let h = fset.contains(&'h');
                compare_sort_numeric(
                    &parse_sort_numeric(&first, h),
                    &parse_sort_numeric(&second, h),
                )
            } else {
                first.cmp(&second)
            };
            if fset.contains(&'r') {
                ord.reverse()
            } else {
                ord
            }
        };

    let key_compare = |left: &[u8], right: &[u8]| -> std::cmp::Ordering {
        if simple {
            let ord = left.cmp(right);
            return if global_rev { ord.reverse() } else { ord };
        }
        if keys.is_empty() {
            return compare_single_key(left, right, &flags, true);
        }
        for key in &keys {
            let fset = if key.flags.is_empty() {
                &flags
            } else {
                &key.flags
            };
            let k1 = extract_sort_key_bytes(left, key, separator, fset.contains(&'b'));
            let k2 = extract_sort_key_bytes(right, key, separator, fset.contains(&'b'));
            let ord = compare_single_key(k1, k2, fset, false);
            if ord != std::cmp::Ordering::Equal {
                return ord;
            }
        }
        std::cmp::Ordering::Equal
    };

    let full_compare = |left: &[u8], right: &[u8]| -> std::cmp::Ordering {
        let ord = key_compare(left, right);
        if ord != std::cmp::Ordering::Equal || simple || stable || unique {
            return ord;
        }
        let fallback = left.cmp(right);
        if global_rev {
            fallback.reverse()
        } else {
            fallback
        }
    };

    if checking {
        let recs = &per_file_records[0];
        for idx in 1..recs.len() {
            let prev = &recs[idx - 1];
            let cur = &recs[idx];
            if full_compare(prev, cur) == std::cmp::Ordering::Greater
                || (unique && key_compare(prev, cur) == std::cmp::Ordering::Equal)
            {
                if flags.contains(&'C') {
                    return err_out("", 1);
                }
                return err_out(&format!("sort: disorder at record {}\n", idx + 1), 1);
            }
        }
        return ok_out("");
    }

    let sorted_records: Vec<Vec<u8>> = if flags.contains(&'m') {
        let mut cursors = vec![0usize; per_file_records.len()];
        let total: usize = per_file_records.iter().map(|v| v.len()).sum();
        let mut merged = Vec::with_capacity(total);
        loop {
            let mut best_file: Option<usize> = None;
            for f_idx in 0..per_file_records.len() {
                let c = cursors[f_idx];
                if c < per_file_records[f_idx].len() {
                    match best_file {
                        None => best_file = Some(f_idx),
                        Some(bf) => {
                            let cand = &per_file_records[f_idx][c];
                            let best = &per_file_records[bf][cursors[bf]];
                            if full_compare(cand, best) == std::cmp::Ordering::Less {
                                best_file = Some(f_idx);
                            }
                        }
                    }
                }
            }
            match best_file {
                Some(bf) => {
                    let c = cursors[bf];
                    merged.push(per_file_records[bf][c].clone());
                    cursors[bf] += 1;
                }
                None => break,
            }
        }
        merged
    } else {
        let mut all: Vec<Vec<u8>> = per_file_records.into_iter().flatten().collect();
        all.sort_by(|a, b| full_compare(a, b));
        all
    };

    let mut out_bytes: Vec<u8> = Vec::new();
    let mut prev_emitted: Option<&[u8]> = None;
    for rec in &sorted_records {
        if unique
            && let Some(prev) = prev_emitted
            && key_compare(prev, rec) == std::cmp::Ordering::Equal
        {
            continue;
        }
        out_bytes.extend_from_slice(rec);
        out_bytes.push(delim_byte);
        prev_emitted = Some(rec);
    }

    if let Some(ref of) = out_file {
        let dest = resolve_posix_path(cwd, of);
        if let Err(e) = fs.write_file(&dest, &out_bytes) {
            return err_out(&format!("sort: open failed: {of}: {e}\n"), 2);
        }
        return ok_out("");
    }
    ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
}

fn cmd_uniq(
    args: &[String],
    stdin: &str,
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

    let parse_nonneg = |val: &str, label: &str| -> Result<usize, String> {
        if val.is_empty() || !val.bytes().all(|b| b.is_ascii_digit()) {
            return Err(format!("uniq: invalid {label}: '{val}'\n"));
        }
        val.parse::<usize>()
            .map_err(|_| format!("uniq: invalid {label}: '{val}'\n"))
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
    if operands.len() == 2 && operands[0] != "-" && operands[1] != "-" {
        let src = resolve_posix_path(cwd, &operands[0]);
        let dst = resolve_posix_path(cwd, &operands[1]);
        if src == dst && fs.exists(&src) {
            return err_out("uniq: input and output must be different files\n", 2);
        }
    }

    let in_name = operands.first().map(|s| s.as_str()).unwrap_or("-");
    let raw = if in_name == "-" {
        crate::vfs::stream_string_to_bytes(stdin)
    } else {
        let path = resolve_posix_path(cwd, in_name);
        if fs.is_dir(&path) {
            return err_out(&format!("uniq: {in_name}: Is a directory\n"), 1);
        }
        match fs.read_file(&path) {
            Ok(b) => b,
            Err(e) => return err_out(&format!("uniq: {in_name}: {e}\n"), 1),
        }
    };

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
        if identity_key {
            return bytes.to_vec();
        }
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

    let mut records: Vec<&[u8]> = Vec::new();
    if !raw.is_empty() {
        let mut start = 0usize;
        for (idx, &b) in raw.iter().enumerate() {
            if b == delimiter {
                records.push(&raw[start..idx]);
                start = idx + 1;
            }
        }
        if start < raw.len() {
            records.push(&raw[start..]);
        }
    }

    let expanded = has_all_repeated || group_method.is_some();
    let method = group_method.as_deref().unwrap_or(&repeated_method);
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut previous: Option<&[u8]> = None;
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

    for line in records {
        let cur_key = compute_key(line);
        if let Some(ref pk) = previous_key
            && pk == &cur_key
        {
            count += 1;
            if expanded && !unique_only {
                if has_all_repeated && count == 2 {
                    if method == "prepend" || (method == "separate" && emitted_group) {
                        out_bytes.push(delimiter);
                    }
                    emit_line(&mut out_bytes, previous.unwrap(), count);
                    emitted_group = true;
                }
                out_bytes.extend_from_slice(line);
                out_bytes.push(delimiter);
            }
        } else {
            if !expanded
                && let Some(prev) = previous
                && selected(count)
            {
                emit_line(&mut out_bytes, prev, count);
            }
            previous = Some(line);
            previous_key = Some(cur_key);
            count = 1;
            if group_method.is_some() {
                if method == "prepend" || method == "both" || emitted_group {
                    out_bytes.push(delimiter);
                }
                emit_line(&mut out_bytes, line, count);
                emitted_group = true;
            }
        }
    }
    if !expanded
        && let Some(prev) = previous
        && selected(count)
    {
        emit_line(&mut out_bytes, prev, count);
    }
    if emitted_group && (method == "append" || method == "both") {
        out_bytes.push(delimiter);
    }

    if let Some(out_name) = operands.get(1)
        && out_name != "-"
    {
        let dst = resolve_posix_path(cwd, out_name);
        if let Err(e) = fs.write_file(&dst, &out_bytes) {
            return err_out(&format!("uniq: {out_name}: {e}\n"), 1);
        }
        return ok_out("");
    }
    ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
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
    stdin: &str,
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
            return Err("cut: only one type of list may be specified\n".to_string());
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
        return err_out("cut: you must specify a list of bytes, characters, or fields\n", 2);
    };
    if active_mode != 'f' && (raw_delim.is_some() || only_delimited) {
        return err_out("cut: an input delimiter may be specified only when operating on fields\n", 2);
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
            return err_out("cut: the delimiter must be a single character\n", 2);
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

    for name in &names {
        let raw = if name == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let path = resolve_posix_path(cwd, name);
            if fs.is_dir(&path) {
                stderr.push_str(&format!("cut: {name}: Is a directory\n"));
                exit_code = 1;
                continue;
            }
            match fs.read_file(&path) {
                Ok(b) => b,
                Err(e) => {
                    stderr.push_str(&format!("cut: {name}: {e}\n"));
                    exit_code = 1;
                    continue;
                }
            }
        };
        if raw.is_empty() {
            continue;
        }
        let mut records: Vec<&[u8]> = Vec::new();
        let mut r_start = 0usize;
        for (idx, &b) in raw.iter().enumerate() {
            if b == record_delim {
                records.push(&raw[r_start..idx]);
                r_start = idx + 1;
            }
        }
        if r_start < raw.len() {
            records.push(&raw[r_start..]);
        }

        for line_bytes in records {
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
                        continue;
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
                    usize::from_str_radix(count_str, if is_octal { 8 } else { 10 }).unwrap_or(0)
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

fn cmd_tr(args: &[String], stdin: &str) -> BuiltinOutcome {
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
        return err_out("tr: when not truncating set1, string2 must be non-empty\n", 2);
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

    let raw_in = crate::vfs::stream_string_to_bytes(stdin);
    let mut out_bytes: Vec<u8> = Vec::with_capacity(raw_in.len());
    let mut prev_out: Option<u8> = None;
    for &b in &raw_in {
        if deleting && removed[b as usize] {
            continue;
        }
        let mapped = mapping[b as usize];
        if squeezing && squeezed[mapped as usize] && prev_out == Some(mapped) {
            continue;
        }
        prev_out = Some(mapped);
        out_bytes.push(mapped);
    }
    ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
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
    t.parse::<i64>()
        .map_err(|_| format!("nl: invalid line number: '{s}'\n"))
}

fn parse_nl_positive_usize(s: &str) -> Result<usize, String> {
    let t = s.trim();
    match t.parse::<usize>() {
        Ok(v) if v >= 1 => Ok(v),
        _ => Err(format!("nl: invalid number: '{s}'\n")),
    }
}

fn cmd_nl(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut header_style = "n".to_string();
    let mut body_style = "t".to_string();
    let mut footer_style = "n".to_string();
    let mut num_fmt = "rn".to_string();
    let mut sep = "\t".to_string();
    let mut width = 6usize;
    let mut start_num = 1i64;
    let mut incr = 1i64;
    let mut join_blanks = 1usize;
    let mut no_renumber = false;
    let mut default_delim: [u8; 2] = [b'\\', b':'];
    let mut delim_bytes: Vec<u8> = default_delim.to_vec();
    let mut files = Vec::new();
    let mut i = 0usize;
    let mut end_opts = false;

    let apply_delim = |val: &str, def: &mut [u8; 2], cur: &mut Vec<u8>| {
        let next = crate::vfs::stream_string_to_bytes(val);
        if next.len() == 1 {
            def[0] = next[0];
            *cur = def.to_vec();
        } else if next.len() == 2 {
            def[0] = next[0];
            def[1] = next[1];
            *cur = def.to_vec();
        } else {
            *cur = next;
        }
    };

    while i < args.len() {
        let a = &args[i];
        if !end_opts && a == "--" {
            end_opts = true;
            i += 1;
            continue;
        }
        if end_opts || !a.starts_with('-') || a == "-" {
            files.push(a.clone());
            i += 1;
            continue;
        }
        if a.starts_with("--") {
            let (opt, val_opt) = match a.split_once('=') {
                Some((k, v)) => (k, Some(v.to_string())),
                None => (a.as_str(), None),
            };
            if opt == "--no-renumber" {
                if val_opt.is_some() {
                    return err_out(&format!("nl: option '{opt}' doesn't allow an argument\n"), 1);
                }
                no_renumber = true;
                i += 1;
                continue;
            }
            let need_val = |i_ref: &mut usize| -> Result<String, BuiltinOutcome> {
                if let Some(v) = val_opt.clone() {
                    *i_ref += 1;
                    Ok(v)
                } else if *i_ref + 1 < args.len() {
                    let v = args[*i_ref + 1].clone();
                    *i_ref += 2;
                    Ok(v)
                } else {
                    Err(err_out(&format!("nl: option '{opt}' requires an argument\n"), 1))
                }
            };
            match opt {
                "--header-numbering" => {
                    header_style = match need_val(&mut i) {
                        Ok(v) => v,
                        Err(e) => return e,
                    };
                }
                "--body-numbering" => {
                    body_style = match need_val(&mut i) {
                        Ok(v) => v,
                        Err(e) => return e,
                    };
                }
                "--footer-numbering" => {
                    footer_style = match need_val(&mut i) {
                        Ok(v) => v,
                        Err(e) => return e,
                    };
                }
                "--starting-line-number" => {
                    let v = match need_val(&mut i) {
                        Ok(v) => v,
                        Err(e) => return e,
                    };
                    match parse_nl_signed(&v) {
                        Ok(n) => start_num = n,
                        Err(msg) => return err_out(&msg, 1),
                    }
                }
                "--line-increment" => {
                    let v = match need_val(&mut i) {
                        Ok(v) => v,
                        Err(e) => return e,
                    };
                    match parse_nl_signed(&v) {
                        Ok(n) => incr = n,
                        Err(msg) => return err_out(&msg, 1),
                    }
                }
                "--join-blank-lines" => {
                    let v = match need_val(&mut i) {
                        Ok(v) => v,
                        Err(e) => return e,
                    };
                    match parse_nl_positive_usize(&v) {
                        Ok(n) => join_blanks = n,
                        Err(msg) => return err_out(&msg, 1),
                    }
                }
                "--number-separator" => {
                    sep = match need_val(&mut i) {
                        Ok(v) => v,
                        Err(e) => return e,
                    };
                }
                "--number-width" => {
                    let v = match need_val(&mut i) {
                        Ok(v) => v,
                        Err(e) => return e,
                    };
                    match parse_nl_positive_usize(&v) {
                        Ok(n) => width = n,
                        Err(msg) => return err_out(&msg, 1),
                    }
                }
                "--number-format" => {
                    num_fmt = match need_val(&mut i) {
                        Ok(v) => v,
                        Err(e) => return e,
                    };
                }
                "--section-delimiter" => {
                    let v = match need_val(&mut i) {
                        Ok(v) => v,
                        Err(e) => return e,
                    };
                    apply_delim(&v, &mut default_delim, &mut delim_bytes);
                }
                _ => return err_out(&format!("nl: unrecognized option '{a}'\n"), 1),
            }
            continue;
        }

        let chars: Vec<char> = a[1..].chars().collect();
        let mut ci = 0usize;
        while ci < chars.len() {
            let ch = chars[ci];
            if ch == 'p' {
                no_renumber = true;
                ci += 1;
                continue;
            }
            if matches!(ch, 'h' | 'b' | 'f' | 'v' | 'i' | 'l' | 's' | 'w' | 'n' | 'd') {
                let rest: String = chars[ci + 1..].iter().collect();
                let val = if !rest.is_empty() {
                    rest
                } else if i + 1 < args.len() {
                    i += 1;
                    args[i].clone()
                } else {
                    return err_out(&format!("nl: option requires an argument -- '{ch}'\n"), 1);
                };
                match ch {
                    'h' => header_style = val,
                    'b' => body_style = val,
                    'f' => footer_style = val,
                    'v' => match parse_nl_signed(&val) {
                        Ok(n) => start_num = n,
                        Err(msg) => return err_out(&msg, 1),
                    },
                    'i' => match parse_nl_signed(&val) {
                        Ok(n) => incr = n,
                        Err(msg) => return err_out(&msg, 1),
                    },
                    'l' => match parse_nl_positive_usize(&val) {
                        Ok(n) => join_blanks = n,
                        Err(msg) => return err_out(&msg, 1),
                    },
                    's' => sep = val,
                    'w' => match parse_nl_positive_usize(&val) {
                        Ok(n) => width = n,
                        Err(msg) => return err_out(&msg, 1),
                    },
                    'n' => num_fmt = val,
                    'd' => apply_delim(&val, &mut default_delim, &mut delim_bytes),
                    _ => unreachable!(),
                }
                break;
            } else {
                return err_out(&format!("nl: invalid option -- '{ch}'\n"), 1);
            }
        }
        i += 1;
    }

    for st in [&header_style, &body_style, &footer_style] {
        if let Err(msg) = validate_nl_style(st) {
            return err_out(&msg, 1);
        }
    }
    if !matches!(num_fmt.as_str(), "ln" | "rn" | "rz") {
        return err_out(&format!("nl: invalid line numbering format: '{num_fmt}'\n"), 1);
    }

    let targets: Vec<String> = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };
    let sep_bytes = crate::vfs::stream_string_to_bytes(&sep);
    let pad_unnumbered = " ".repeat(width + sep_bytes.len());
    let d1 = delim_bytes.clone();
    let d2 = [delim_bytes.as_slice(), delim_bytes.as_slice()].concat();
    let d3 = [delim_bytes.as_slice(), delim_bytes.as_slice(), delim_bytes.as_slice()].concat();

    let mut current_style = body_style.clone();
    let mut n = start_num;
    let mut blanks = 0usize;
    let mut out = String::new();
    let mut stderr = String::new();
    let mut code = 0;

    for f in &targets {
        let raw = if f == "-" {
            stdin.to_string()
        } else {
            let p = resolve_posix_path(cwd, f);
            match fs.read_file(&p) {
                Ok(b) => crate::vfs::bytes_to_stream_string(&b),
                Err(e) => {
                    stderr.push_str(&format!("nl: {f}: {e}\n"));
                    code = 1;
                    continue;
                }
            }
        };
        if raw.is_empty() {
            continue;
        }
        let body_slice = raw.strip_suffix('\n').unwrap_or(&raw);
        for line in body_slice.split('\n') {
            let line_bytes = crate::vfs::stream_string_to_bytes(line);
            if !d1.is_empty() {
                if line_bytes == d3 {
                    current_style = header_style.clone();
                    if !no_renumber {
                        n = start_num;
                    }
                    blanks = 0;
                    out.push('\n');
                    continue;
                } else if line_bytes == d2 {
                    current_style = body_style.clone();
                    if !no_renumber {
                        n = start_num;
                    }
                    blanks = 0;
                    out.push('\n');
                    continue;
                } else if line_bytes == d1 {
                    current_style = footer_style.clone();
                    if !no_renumber {
                        n = start_num;
                    }
                    blanks = 0;
                    out.push('\n');
                    continue;
                }
            }

            let should_num = match current_style.as_str() {
                "a" => {
                    if !line.is_empty() {
                        blanks = 0;
                        true
                    } else {
                        blanks += 1;
                        if blanks == join_blanks || join_blanks == 1 {
                            blanks = 0;
                            true
                        } else {
                            false
                        }
                    }
                }
                "t" => !line.is_empty(),
                "n" => false,
                s if s.starts_with('p') => {
                    let pat = &s[1..];
                    crate::commands::search::ZeroRegex::new(vec![pat.to_string()], false, false, false, false)
                        .is_match(line)
                }
                _ => !line.is_empty(),
            };

            if !should_num {
                out.push_str(&pad_unnumbered);
                out.push_str(line);
                out.push('\n');
            } else {
                let label = n.to_string();
                let pad = width.saturating_sub(label.len());
                let formatted_num = match num_fmt.as_str() {
                    "ln" => format!("{label}{}", " ".repeat(pad)),
                    "rz" if n < 0 => format!("-{}{}", "0".repeat(pad), &label[1..]),
                    "rz" => format!("{}{label}", "0".repeat(pad)),
                    _ => format!("{}{label}", " ".repeat(pad)),
                };
                out.push_str(&formatted_num);
                out.push_str(&sep);
                out.push_str(line);
                out.push('\n');
                n = n.wrapping_add(incr);
            }
        }
    }

    BuiltinOutcome {
        stdout: out,
        stderr,
        exit_code: code,
    }
}

fn cmd_tac(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
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
        } else if (a == "-s" || a == "--separator") && i + 1 < args.len() {
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
    let targets: Vec<String> = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };
    let mut out_bytes: Vec<u8> = Vec::new();
    for f in &targets {
        let bytes = if f == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let full = resolve_posix_path(cwd, f);
            match fs.read_file(&full) {
                Ok(b) => b,
                Err(e) => {
                    return BuiltinOutcome {
                        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                        stderr: format!("tac: {f}: {e}\n"),
                        exit_code: 1,
                    };
                }
            }
        };
        if regex_mode {
            let pat_str = String::from_utf8_lossy(&sep_bytes).to_string();
            let anchored = if pat_str.starts_with("^") {
                pat_str
            } else {
                format!("^{pat_str}")
            };
            let re = crate::commands::search::ZeroRegex::new(
                vec![anchored],
                false,
                false,
                false,
                false,
            );
            let text_latin1: String = bytes.iter().map(|&b| b as char).collect();
            let char_to_byte: Vec<usize> = text_latin1
                .char_indices()
                .map(|(bi, _)| bi)
                .chain(std::iter::once(text_latin1.len()))
                .collect();
            let mut end = bytes.len();
            let mut idx = bytes.len();
            while idx > 0 {
                idx -= 1;
                let slice_str = &text_latin1[char_to_byte[idx]..char_to_byte[bytes.len()]];
                let matches = re.find_all(slice_str);
                if let Some(&(_, m_end_byte)) = matches.first() {
                    let matched_chars = slice_str[..m_end_byte].chars().count();
                    let match_end = idx + matched_chars;
                    let boundary = if before { idx } else { match_end };
                    if boundary <= end {
                        out_bytes.extend_from_slice(&bytes[boundary..end]);
                        end = boundary;
                    }
                }
            }
            out_bytes.extend_from_slice(&bytes[0..end]);
        } else {
            let slen = sep_bytes.len();
            let mut end = bytes.len();
            if slen > 0 && bytes.len() >= slen {
                let mut idx = bytes.len() - slen;
                loop {
                    if bytes[idx..idx + slen] == sep_bytes[..] {
                        let boundary = if before { idx } else { idx + slen };
                        out_bytes.extend_from_slice(&bytes[boundary..end]);
                        end = boundary;
                        if idx < slen {
                            break;
                        }
                        idx -= slen;
                        continue;
                    }
                    if idx == 0 {
                        break;
                    }
                    idx -= 1;
                }
            }
            out_bytes.extend_from_slice(&bytes[0..end]);
        }
    }
    ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
}

fn cmd_rev(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            files.extend(args[i + 1..].iter().cloned());
            break;
        } else if !a.starts_with('-') || a == "-" {
            files.push(a.clone());
            i += 1;
        } else {
            return err_out(&format!("rev: invalid option -- '{}'\n", &a[1..]), 1);
        }
    }
    let locale = env
        .get("LC_ALL")
        .filter(|s| !s.is_empty())
        .or_else(|| env.get("LC_CTYPE").filter(|s| !s.is_empty()))
        .or_else(|| env.get("LANG").filter(|s| !s.is_empty()))
        .map(|s| s.as_str())
        .unwrap_or("C");
    let lower_loc = locale.to_ascii_lowercase();
    let utf8 = lower_loc.contains("utf-8") || lower_loc.contains("utf8");
    if !utf8 && locale != "C" && locale != "POSIX" {
        return err_out(
            &format!("rev: unsupported character encoding locale: '{locale}'\n"),
            1,
        );
    }

    let targets: Vec<String> = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files.clone()
    };
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut code = 0;

    for f in &targets {
        let bytes = if f == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let p = resolve_posix_path(cwd, f);
            match fs.read_file(&p) {
                Ok(b) => b,
                Err(e) => {
                    stderr.push_str(&format!("rev: {f}: {e}\n"));
                    code = 1;
                    continue;
                }
            }
        };
        if bytes.is_empty() {
            continue;
        }
        let mut pos = 0usize;
        while pos < bytes.len() {
            let (rec, terminated) = match bytes[pos..].iter().position(|&b| b == b'\n') {
                Some(nl_off) => {
                    let r = &bytes[pos..pos + nl_off];
                    pos += nl_off + 1;
                    (r, true)
                }
                None => {
                    let r = &bytes[pos..];
                    pos = bytes.len();
                    (r, false)
                }
            };
            if !utf8 {
                for &b in rec.iter().rev() {
                    out_bytes.push(b);
                }
                if terminated {
                    out_bytes.push(b'\n');
                }
            } else {
                let valid_len = match std::str::from_utf8(rec) {
                    Ok(_) => rec.len(),
                    Err(e) => e.valid_up_to(),
                };
                if valid_len > 0 || valid_len == rec.len() {
                    let valid_str = std::str::from_utf8(&rec[..valid_len]).unwrap_or("");
                    let rev_str: String = valid_str.chars().rev().collect();
                    out_bytes.extend_from_slice(rev_str.as_bytes());
                    if terminated || valid_len != rec.len() {
                        out_bytes.push(b'\n');
                    }
                }
                if valid_len != rec.len() {
                    let label = if f == "-" && files.is_empty() {
                        "stdin"
                    } else {
                        f.as_str()
                    };
                    stderr.push_str(&format!("rev: {label}: Illegal byte sequence\n"));
                    code = 1;
                    break;
                }
            }
        }
    }

    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        stderr,
        exit_code: code,
    }
}

fn parse_paste_delimiters(text: &str) -> Result<Vec<Vec<u8>>, String> {
    let chars: Vec<char> = text.chars().collect();
    let mut result: Vec<Vec<u8>> = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\\' {
            if i + 1 >= chars.len() {
                return Err("paste: delimiter list ends in an unescaped backslash\n".to_string());
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

fn split_records_by_byte(bytes: &[u8], sep: u8) -> Vec<Vec<u8>> {
    if bytes.is_empty() {
        return Vec::new();
    }
    let mut recs: Vec<Vec<u8>> = bytes.split(|&b| b == sep).map(|s| s.to_vec()).collect();
    if bytes.last() == Some(&sep) {
        recs.pop();
    }
    recs
}

fn cmd_paste(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
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
                return err_out("paste: option '--delimiters' requires an argument\n", 1);
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
            return err_out(&format!("paste: unsupported option {token}\n"), 1);
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
                        return err_out("paste: option '-d' requires an argument\n", 1);
                    };
                    match parse_paste_delimiters(&val) {
                        Ok(d) => delims = d,
                        Err(msg) => return err_out(&msg, 1),
                    }
                    break;
                }
                c => return err_out(&format!("paste: unsupported option -{c}\n"), 1),
            }
        }
        i += 1;
    }

    if files.is_empty() {
        files.push("-".to_string());
    }

    let stdin_bytes = crate::vfs::stream_string_to_bytes(stdin);
    let mut stdin_recs = std::collections::VecDeque::from(split_records_by_byte(&stdin_bytes, sep_byte));
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut status = 0;

    if serial {
        for f in &files {
            let recs: Vec<Vec<u8>> = if f == "-" {
                stdin_recs.drain(..).collect()
            } else {
                let p = resolve_posix_path(cwd, f);
                if fs.is_dir(&p) {
                    stderr.push_str(&format!("paste: {f}: Is a directory\n"));
                    status = 1;
                    continue;
                }
                match fs.read_file(&p) {
                    Ok(b) => split_records_by_byte(&b, sep_byte),
                    Err(e) => {
                        stderr.push_str(&format!("paste: {f}: {e}\n"));
                        status = 1;
                        continue;
                    }
                }
            };
            if !recs.is_empty() {
                for (idx, rec) in recs.iter().enumerate() {
                    if idx > 0 {
                        out_bytes.extend_from_slice(&delims[(idx - 1) % delims.len()]);
                    }
                    out_bytes.extend_from_slice(rec);
                }
                out_bytes.push(sep_byte);
            }
        }
        return BuiltinOutcome {
            stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
            stderr,
            exit_code: status,
        };
    }

    enum PasteSource {
        Stdin,
        File(std::collections::VecDeque<Vec<u8>>),
    }

    let mut sources: Vec<PasteSource> = Vec::with_capacity(files.len());
    for f in &files {
        if f == "-" {
            sources.push(PasteSource::Stdin);
        } else {
            let p = resolve_posix_path(cwd, f);
            if fs.is_dir(&p) {
                return err_out(&format!("paste: {f}: Is a directory\n"), 1);
            }
            match fs.read_file(&p) {
                Ok(b) => sources.push(PasteSource::File(std::collections::VecDeque::from(
                    split_records_by_byte(&b, sep_byte),
                ))),
                Err(e) => return err_out(&format!("paste: {f}: {e}\n"), 1),
            }
        }
    }

    loop {
        let mut row_bytes: Vec<u8> = Vec::new();
        let mut present = false;
        for (col, src) in sources.iter_mut().enumerate() {
            let rec = match src {
                PasteSource::Stdin => stdin_recs.pop_front(),
                PasteSource::File(q) => q.pop_front(),
            };
            if rec.is_some() {
                present = true;
            }
            if col > 0 {
                row_bytes.extend_from_slice(&delims[(col - 1) % delims.len()]);
            }
            if let Some(r) = rec {
                row_bytes.extend_from_slice(&r);
            }
        }
        if !present {
            break;
        }
        row_bytes.push(sep_byte);
        out_bytes.extend_from_slice(&row_bytes);
    }

    ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CommOrderMode {
    Default,
    Check,
    None,
}

fn cmd_comm(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
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
                return err_out("comm: option --output-delimiter requires an argument\n", 1);
            };
            let candidate = if val.is_empty() {
                vec![0u8]
            } else {
                crate::vfs::stream_string_to_bytes(&val)
            };
            if delim_set && candidate != delim {
                return err_out("comm: multiple conflicting output delimiters\n", 1);
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
            return err_out(&format!("comm: unsupported option {token}\n"), 1);
        }
    }

    if files.len() != 2 {
        return err_out("comm: comm requires exactly two files\n", 1);
    }

    let stdin_bytes = crate::vfs::stream_string_to_bytes(stdin);
    let mut stdin_q = std::collections::VecDeque::from(split_records_by_byte(&stdin_bytes, sep_byte));

    enum CommSource {
        Stdin,
        File(std::collections::VecDeque<Vec<u8>>),
    }

    let mut sources: Vec<CommSource> = Vec::with_capacity(2);
    for f in &files {
        if f == "-" {
            sources.push(CommSource::Stdin);
        } else {
            let p = resolve_posix_path(cwd, f);
            if fs.is_dir(&p) {
                return err_out(&format!("comm: {f}: Is a directory\n"), 1);
            }
            match fs.read_file(&p) {
                Ok(b) => sources.push(CommSource::File(std::collections::VecDeque::from(
                    split_records_by_byte(&b, sep_byte),
                ))),
                Err(e) => return err_out(&format!("comm: {f}: {e}\n"), 1),
            }
        }
    }

    let next_from = |idx: usize, srcs: &mut [CommSource], sq: &mut std::collections::VecDeque<Vec<u8>>| -> Option<Vec<u8>> {
        match &mut srcs[idx] {
            CommSource::Stdin => sq.pop_front(),
            CommSource::File(q) => q.pop_front(),
        }
    };

    let mut rows: [Option<Vec<u8>>; 2] = [
        next_from(0, &mut sources, &mut stdin_q),
        next_from(1, &mut sources, &mut stdin_q),
    ];
    let mut previous: [Option<Vec<u8>>; 2] = [None, None];
    let mut totals = [0u64; 3];
    let mut unpaired = false;
    let mut failed = false;
    let mut warned = [false; 2];
    let mut pending = [false; 2];
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();

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
                    let msg = format!("comm: file {} is not in sorted order\n", f_idx + 1);
                    if mode == CommOrderMode::Check {
                        stderr.push_str(&msg);
                        return BuiltinOutcome {
                            stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                            stderr,
                            exit_code: 1,
                        };
                    }
                    warned[f_idx] = true;
                    failed = true;
                    stderr.push_str(&msg);
                }
            }
            pending = [false; 2];
        }

        if !suppressed[col] {
            for k in 0..col {
                if !suppressed[k] {
                    out_bytes.extend_from_slice(&delim);
                }
            }
            let r = if col == 1 {
                rows[1].as_ref().unwrap()
            } else {
                rows[0].as_ref().unwrap()
            };
            out_bytes.extend_from_slice(r);
            out_bytes.push(sep_byte);
        }

        for idx in 0..2 {
            if (idx == 0 && ord == std::cmp::Ordering::Greater)
                || (idx == 1 && ord == std::cmp::Ordering::Less)
            {
                continue;
            }
            let next = next_from(idx, &mut sources, &mut stdin_q);
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
                    let msg = format!("comm: file {} is not in sorted order\n", idx + 1);
                    if mode == CommOrderMode::Check {
                        stderr.push_str(&msg);
                        return BuiltinOutcome {
                            stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                            stderr,
                            exit_code: 1,
                        };
                    }
                    warned[idx] = true;
                    failed = true;
                    stderr.push_str(&msg);
                }
            }
            previous[idx] = rows[idx].take();
            rows[idx] = next;
        }
    }

    if files[0] == "-" && files[1] == "-" {
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

fn cmd_tee(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
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
    let mut valid_paths = Vec::new();
    let mut stderr = String::new();
    let mut code = 0;

    for f in &files {
        let p = resolve_posix_path(cwd, f);
        if fs.is_dir(&p) {
            stderr.push_str(&format!("tee: {f}: Is a directory\n"));
            code = 1;
            if exit_on_error {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr,
                    exit_code: 1,
                };
            }
            continue;
        }
        let parent = dirname_posix_path(&p);
        if !fs.is_dir(&parent) {
            stderr.push_str(&format!("tee: {f}: No such file or directory\n"));
            code = 1;
            if exit_on_error {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr,
                    exit_code: 1,
                };
            }
            continue;
        }
        valid_paths.push((f.clone(), p));
    }

    let in_bytes = crate::vfs::stream_string_to_bytes(stdin);
    for (f, p) in valid_paths {
        let data = if append && fs.exists(&p) {
            let mut prev = fs.read_file(&p).unwrap_or_default();
            prev.extend_from_slice(&in_bytes);
            prev
        } else {
            in_bytes.clone()
        };
        if let Err(e) = fs.write_file(&p, &data) {
            stderr.push_str(&format!("tee: {f}: {e}\n"));
            code = 1;
            if exit_on_error {
                return BuiltinOutcome {
                    stdout: stdin.to_string(),
                    stderr,
                    exit_code: 1,
                };
            }
        }
    }

    BuiltinOutcome {
        stdout: stdin.to_string(),
        stderr,
        exit_code: code,
    }
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
    let in_bytes = crate::vfs::stream_string_to_bytes(stdin);
    let data = if append && fs.exists(&p) {
        let mut prev = match fs.read_file(&p) {
            Ok(b) => b,
            Err(e) => return err_out(&format!("sponge: {f}: {e}\n"), 1),
        };
        prev.extend_from_slice(&in_bytes);
        prev
    } else {
        in_bytes
    };
    if let Err(e) = fs.write_file(&p, &data) {
        return err_out(&format!("sponge: {f}: {e}\n"), 1);
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

fn cmd_yes(args: &[String]) -> BuiltinOutcome {
    let mut delimiter_idx: Option<usize> = None;
    for (idx, arg) in args.iter().enumerate() {
        if arg == "--" {
            delimiter_idx = Some(idx);
            break;
        }
        if arg == "-" || !arg.starts_with('-') {
            continue;
        }
        if arg == "--help" {
            return ok_out("Usage: yes [STRING]...\n");
        }
        if arg == "--version" {
            return ok_out("yes (virtual-bash GNU-compatible profile)\n");
        }
        return err_out(&format!("yes: invalid option '{arg}'\n"), 1);
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
            return ok_out("Usage: printenv [-0|--null] [--] [NAME ...]\n");
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
        for (k, v) in env {
            if k.starts_with("__")
                || k.contains('[')
                || k == "!"
                || env.contains_key(&format!("__unexported__{k}"))
            {
                continue;
            }
            out.push_str(&format!("{k}={v}{sep}"));
        }
        return ok_out(&out);
    }
    let mut out = String::new();
    let mut code = 0;
    for k in names {
        if k.contains('=') {
            code = 1;
            continue;
        }
        if !env.contains_key(&format!("__unexported__{k}"))
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

fn cmd_envsubst(args: &[String], stdin: &str, env: &BTreeMap<String, String>) -> BuiltinOutcome {
    let mut list_vars = false;
    let mut operands = Vec::new();
    let mut end_opts = false;
    for a in args {
        if !end_opts && a == "--" {
            end_opts = true;
            continue;
        }
        if !end_opts && (a == "-h" || a == "--help") {
            return ok_out("Usage: envsubst [OPTION] [SHELL-FORMAT]\n");
        }
        if !end_opts && (a == "-V" || a == "--version") {
            return ok_out("envsubst (Sandbox VFS-ish/GNU gettext-runtime) 0.22.5\n");
        }
        if !end_opts && (a == "-v" || a == "--variables") {
            list_vars = true;
            continue;
        }
        if !end_opts && a.starts_with('-') {
            return err_out(&format!("envsubst: invalid option '{a}'\n"), 1);
        }
        operands.push(a.clone());
    }
    if operands.len() > 1 {
        return err_out("envsubst: too many arguments\n", 1);
    }
    if list_vars {
        if operands.is_empty() {
            return err_out("envsubst: missing arguments\n", 1);
        }
        let vars = extract_envsubst_vars(&operands[0]);
        let mut out = String::new();
        for v in vars {
            out.push_str(&v);
            out.push('\n');
        }
        return ok_out(&out);
    }
    let whitelist: Option<BTreeSet<String>> = operands
        .first()
        .map(|sf| extract_envsubst_vars(sf).into_iter().collect());

    let bytes = stdin.as_bytes();
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
                if !env.contains_key(&format!("__unexported__{name}"))
                    && let Some(val) = env.get(name)
                {
                    out.extend_from_slice(val.as_bytes());
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
    ok_out(&String::from_utf8_lossy(&out))
}

fn cmd_expr(args: &[String]) -> BuiltinOutcome {
    if args.is_empty() {
        return err_out("expr: missing operand\n", 2);
    }
    let mut pos = 0usize;
    match eval_expr_or(args, &mut pos) {
        Ok(res) => {
            let is_zero = res == "0" || res.is_empty();
            BuiltinOutcome {
                stdout: format!("{res}\n"),
                stderr: String::new(),
                exit_code: if is_zero { 1 } else { 0 },
            }
        }
        Err((msg, code)) => err_out(&msg, code),
    }
}

fn is_expr_truthy(v: &str) -> bool {
    !v.is_empty() && v != "0"
}

fn eval_expr_or(args: &[String], pos: &mut usize) -> Result<String, (String, i32)> {
    let mut left = eval_expr_and(args, pos)?;
    while *pos < args.len() && args[*pos] == "|" {
        *pos += 1;
        let right = eval_expr_and(args, pos)?;
        if !is_expr_truthy(&left) {
            left = if is_expr_truthy(&right) { right } else { "0".to_string() };
        }
    }
    Ok(left)
}

fn eval_expr_and(args: &[String], pos: &mut usize) -> Result<String, (String, i32)> {
    let mut left = eval_expr_cmp(args, pos)?;
    while *pos < args.len() && args[*pos] == "&" {
        *pos += 1;
        let right = eval_expr_cmp(args, pos)?;
        if !(is_expr_truthy(&left) && is_expr_truthy(&right)) {
            left = "0".to_string();
        }
    }
    Ok(left)
}

fn eval_expr_cmp(args: &[String], pos: &mut usize) -> Result<String, (String, i32)> {
    let mut left = eval_expr_add(args, pos)?;
    while *pos < args.len() && matches!(args[*pos].as_str(), "=" | "==" | "!=" | "<" | "<=" | ">" | ">=") {
        let op = args[*pos].clone();
        *pos += 1;
        let right = eval_expr_add(args, pos)?;
        let res = if let (Ok(a), Ok(b)) = (left.parse::<i64>(), right.parse::<i64>()) {
            match op.as_str() {
                "=" | "==" => a == b,
                "!=" => a != b,
                "<" => a < b,
                "<=" => a <= b,
                ">" => a > b,
                ">=" => a >= b,
                _ => false,
            }
        } else {
            match op.as_str() {
                "=" | "==" => left == right,
                "!=" => left != right,
                "<" => left < right,
                "<=" => left <= right,
                ">" => left > right,
                ">=" => left >= right,
                _ => false,
            }
        };
        left = if res { "1".to_string() } else { "0".to_string() };
    }
    Ok(left)
}

fn eval_expr_add(args: &[String], pos: &mut usize) -> Result<String, (String, i32)> {
    let mut left = eval_expr_mul(args, pos)?;
    while *pos < args.len() && matches!(args[*pos].as_str(), "+" | "-") {
        let op = args[*pos].clone();
        *pos += 1;
        let right = eval_expr_mul(args, pos)?;
        let a = left.parse::<i64>().unwrap_or(0);
        let b = right.parse::<i64>().unwrap_or(0);
        left = if op == "+" { (a + b).to_string() } else { (a - b).to_string() };
    }
    Ok(left)
}

fn eval_expr_mul(args: &[String], pos: &mut usize) -> Result<String, (String, i32)> {
    let mut left = eval_expr_match(args, pos)?;
    while *pos < args.len() && matches!(args[*pos].as_str(), "*" | "/" | "%") {
        let op = args[*pos].clone();
        *pos += 1;
        let right = eval_expr_match(args, pos)?;
        let a = left.parse::<i64>().unwrap_or(0);
        let b = right.parse::<i64>().unwrap_or(0);
        left = match op.as_str() {
            "*" => (a * b).to_string(),
            "/" => {
                if b == 0 {
                    return Err(("expr: division by zero\n".to_string(), 2));
                }
                (a / b).to_string()
            }
            "%" => {
                if b == 0 {
                    return Err(("expr: division by zero\n".to_string(), 2));
                }
                (a % b).to_string()
            }
            _ => "0".to_string(),
        };
    }
    Ok(left)
}

fn eval_expr_colon(lhs: &str, pat: &str) -> String {
    let has_group = pat.contains("\\(") || pat.contains('(');
    let anchored = format!("^{}", pat.strip_prefix('^').unwrap_or(pat));
    if let Some(caps) = crate::commands::search::regex_captures(&anchored, lhs, false) {
        if has_group {
            caps.get(1).cloned().unwrap_or_default()
        } else {
            caps.first().map(|m| m.chars().count().to_string()).unwrap_or_else(|| "0".to_string())
        }
    } else if has_group {
        String::new()
    } else {
        "0".to_string()
    }
}

fn eval_expr_match(args: &[String], pos: &mut usize) -> Result<String, (String, i32)> {
    let mut left = eval_expr_primary(args, pos)?;
    while *pos < args.len() && args[*pos] == ":" {
        *pos += 1;
        let right = eval_expr_primary(args, pos)?;
        left = eval_expr_colon(&left, &right);
    }
    Ok(left)
}

fn eval_expr_primary(args: &[String], pos: &mut usize) -> Result<String, (String, i32)> {
    if *pos >= args.len() {
        return Err(("expr: syntax error\n".to_string(), 2));
    }
    let tok = &args[*pos];
    if tok == "(" {
        *pos += 1;
        let val = eval_expr_or(args, pos)?;
        if *pos < args.len() && args[*pos] == ")" {
            *pos += 1;
        }
        return Ok(val);
    }
    if tok == "length" && *pos + 1 < args.len() {
        *pos += 1;
        let s = eval_expr_primary(args, pos)?;
        return Ok(s.chars().count().to_string());
    }
    if tok == "match" && *pos + 2 < args.len() {
        *pos += 1;
        let s = eval_expr_primary(args, pos)?;
        let pat = eval_expr_primary(args, pos)?;
        return Ok(eval_expr_colon(&s, &pat));
    }
    if tok == "substr" && *pos + 3 < args.len() {
        *pos += 1;
        let s_str = eval_expr_primary(args, pos)?;
        let p_str = eval_expr_primary(args, pos)?;
        let l_str = eval_expr_primary(args, pos)?;
        let chars: Vec<char> = s_str.chars().collect();
        let p = p_str.parse::<usize>().unwrap_or(0);
        let l = l_str.parse::<usize>().unwrap_or(0);
        let sub: String = if p == 0 || l == 0 || p > chars.len() {
            String::new()
        } else {
            chars[p - 1..(p - 1 + l).min(chars.len())].iter().collect()
        };
        return Ok(sub);
    }
    if tok == "index" && *pos + 2 < args.len() {
        *pos += 1;
        let s = eval_expr_primary(args, pos)?;
        let chars_set = eval_expr_primary(args, pos)?;
        let mut found = 0usize;
        for (i, ch) in s.chars().enumerate() {
            if chars_set.contains(ch) {
                found = i + 1;
                break;
            }
        }
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
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        let rest: String = chars[i..].iter().collect();
        let trimmed = rest.trim_start();
        let skip_ws = rest.len() - trimmed.len();
        if let Some(after_def) = trimmed.strip_prefix("define ") {
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
                    for (bi, ch) in body_sub.char_indices() {
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
                        let consumed_bytes = skip_ws + "define ".len() + close_p + 1 + open_b + 1 + eb + 1;
                        let consumed_chars = rest[..consumed_bytes].chars().count();
                        i += consumed_chars;
                        continue;
                    }
                }
            }
        }
        remaining.push(chars[i]);
        i += 1;
    }
    remaining
}

fn cmd_bc(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut mathlib = false;
    let mut exprs: Vec<String> = Vec::new();
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-l" || a == "--mathlib" {
            mathlib = true;
            i += 1;
        } else if (a == "-e" || a == "--expression") && i + 1 < args.len() {
            exprs.push(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-e").or_else(|| a.strip_prefix("--expression="))
            && !rest.is_empty()
        {
            exprs.push(rest.to_string());
            i += 1;
        } else if !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
        } else {
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
    };
    let mut no_comments = String::new();
    for line in input.lines() {
        no_comments.push_str(line.split('#').next().unwrap_or(""));
        no_comments.push('\n');
    }
    let body = extract_bc_defines(&no_comments, &mut bc);
    let mut out = String::new();
    for stmt in split_bc_top_stmts(&body) {
        let _ = exec_bc_stmt(&stmt, &mut bc, &mut out, 0);
    }
    ok_out(&out)
}

#[derive(Clone, Debug)]
enum BcFlow {
    None,
    Break,
    Continue,
    Return(BcVal),
}

fn split_bc_top_stmts(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut pdepth = 0i32;
    let mut bdepth = 0i32;
    let mut in_quote = false;
    let chars: Vec<char> = s.chars().collect();
    for (idx, &ch) in chars.iter().enumerate() {
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
                    let rest: String = chars[idx + 1..].iter().collect();
                    if rest.trim_start().starts_with("else") {
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
                let rest: String = chars[idx + 1..].iter().collect();
                if rest.trim_start().starts_with("else") && cur.trim_start().starts_with("if") {
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
    if s.is_empty() || s == "quit" || s.starts_with("auto ") || s == "auto" {
        return BcFlow::None;
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
    if let Some(print_rest) = s.strip_prefix("print ") {
        for item in split_bc_args(print_rest) {
            let t = item.trim();
            if t.starts_with('"') && t.ends_with('"') && t.len() >= 2 {
                out.push_str(&decode_ansi_c_escapes(&t[1..t.len() - 1]));
            } else {
                bc.last_str_out = None;
                let v = eval_bc_val(t, bc, depth + 1);
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
        bc.vars.insert(key, v);
        return BcFlow::None;
    }
    bc.last_str_out = None;
    let val = eval_bc_val(s, bc, depth + 1);
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

fn apply_bc_binop(l: &BcVal, r: &BcVal, op: &str, bc: &BcEnv) -> BcVal {
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

fn cmd_numfmt(args: &[String], stdin: &str) -> BuiltinOutcome {
    let mut to_mode = String::new();
    let mut from_mode = String::new();
    let mut suffix = String::new();
    let mut round_mode = "from-zero".to_string();
    let mut format_spec: Option<String> = None;
    let mut delimiter: Option<String> = None;
    let mut padding: Option<isize> = None;
    let mut header_lines = 0usize;
    let mut fields: Vec<usize> = Vec::new();
    let mut operands = Vec::new();

    let parse_fields = |spec: &str, out_f: &mut Vec<usize>| {
        for part in spec.split(',') {
            if let Some((a, b)) = part.split_once('-') {
                let st = a.parse::<usize>().unwrap_or(1).max(1);
                let en = b.parse::<usize>().unwrap_or(st).max(st);
                for idx in st..=en {
                    out_f.push(idx);
                }
            } else if let Ok(idx) = part.parse::<usize>()
                && idx >= 1
            {
                out_f.push(idx);
            }
        }
    };

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if let Some(v) = a.strip_prefix("--to=") {
            to_mode = v.to_string();
        } else if let Some(v) = a.strip_prefix("--from=") {
            from_mode = v.to_string();
        } else if let Some(v) = a.strip_prefix("--suffix=") {
            suffix = v.to_string();
        } else if let Some(v) = a.strip_prefix("--round=") {
            round_mode = v.to_string();
        } else if let Some(v) = a.strip_prefix("--format=") {
            format_spec = Some(v.to_string());
        } else if let Some(v) = a.strip_prefix("--padding=") {
            padding = v.parse::<isize>().ok();
        } else if a == "--header" {
            header_lines = 1;
        } else if let Some(v) = a.strip_prefix("--header=") {
            header_lines = v.parse::<usize>().unwrap_or(1);
        } else if let Some(v) = a.strip_prefix("--field=") {
            parse_fields(v, &mut fields);
        } else if let Some(v) = a.strip_prefix("--delimiter=") {
            delimiter = Some(v.to_string());
        } else if a == "-d" && i + 1 < args.len() {
            i += 1;
            delimiter = Some(args[i].clone());
        } else if let Some(v) = a.strip_prefix("-d") {
            delimiter = Some(v.to_string());
        } else if !a.starts_with('-') {
            operands.push(a.clone());
        }
        i += 1;
    }
    if fields.is_empty() {
        fields.push(1);
    }

    let inputs: Vec<String> = if operands.is_empty() {
        stdin.lines().map(|l| l.to_string()).filter(|l| !l.is_empty()).collect()
    } else {
        operands
    };

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
            "nearest" => scaled.round(),
            _ => {
                if scaled >= 0.0 {
                    (scaled - 1e-9).ceil()
                } else {
                    (scaled + 1e-9).floor()
                }
            }
        };
        r / factor
    };

    let units = ['K', 'M', 'G', 'T', 'P', 'E'];
    let fmt_val = |raw: &str| -> String {
        let mut val = parse_human_num(raw, &from_mode);
        let rendered = if to_mode == "iec" || to_mode == "iec-i" || to_mode == "si" {
            let base = if to_mode == "si" { 1000.0 } else { 1024.0 };
            let i_suf = if to_mode == "iec-i" { "i" } else { "" };
            if val.abs() < base {
                format!("{}{suffix}", val as i64)
            } else {
                let mut u_idx = 0usize;
                val /= base;
                while val.abs() >= base && u_idx + 1 < units.len() {
                    val /= base;
                    u_idx += 1;
                }
                let u = if to_mode == "si" && u_idx == 0 {
                    'k'
                } else {
                    units[u_idx]
                };
                let (num_s, unit_s) = if val.abs() < 10.0 {
                    let rv = apply_round(val, 1);
                    (format!("{rv:.1}"), format!("{u}{i_suf}{suffix}"))
                } else {
                    let rv = apply_round(val, 0);
                    (format!("{rv:.0}"), format!("{u}{i_suf}{suffix}"))
                };
                if let Some(ref fspec) = format_spec
                    && let Some(inner) = fspec.strip_prefix('%').and_then(|s| s.strip_suffix('f'))
                {
                    let zero_pad = inner.starts_with('0');
                    let width_s = inner.split('.').next().unwrap_or("");
                    if let Ok(w) = width_s.trim_start_matches('0').parse::<usize>()
                        && w > num_s.len()
                    {
                        let pad_ch = if zero_pad { '0' } else { ' ' };
                        let pad_str: String = std::iter::repeat_n(pad_ch, w - num_s.len()).collect();
                        format!("{pad_str}{num_s}{unit_s}")
                    } else {
                        format!("{num_s}{unit_s}")
                    }
                } else {
                    format!("{num_s}{unit_s}")
                }
            }
        } else {
            format!("{}{suffix}", val as i64)
        };
        if let Some(pad) = padding {
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
        }
    };

    let mut out = String::new();
    for (line_no, item) in inputs.into_iter().enumerate() {
        if line_no < header_lines {
            out.push_str(&item);
            out.push('\n');
            continue;
        }
        let formatted = if let Some(ref delim) = delimiter {
            let mut parts: Vec<String> = item.split(delim.as_str()).map(|s| s.to_string()).collect();
            for &f_idx in &fields {
                if f_idx >= 1 && f_idx <= parts.len() {
                    parts[f_idx - 1] = fmt_val(&parts[f_idx - 1]);
                }
            }
            parts.join(delim)
        } else if fields.len() > 1 || fields[0] > 1 {
            let mut parts: Vec<String> = item.split_whitespace().map(|s| s.to_string()).collect();
            for &f_idx in &fields {
                if f_idx >= 1 && f_idx <= parts.len() {
                    let orig_len = parts[f_idx - 1].len();
                    let conv = fmt_val(&parts[f_idx - 1]);
                    parts[f_idx - 1] = if padding.is_none() && orig_len > conv.len() {
                        format!("{conv:>orig_len$}")
                    } else {
                        conv
                    };
                }
            }
            parts.join(" ")
        } else {
            fmt_val(item.trim())
        };
        out.push_str(&formatted);
        out.push('\n');
    }
    ok_out(&out)
}

fn parse_human_num(s: &str, from_mode: &str) -> f64 {
    let trimmed = s.trim().trim_end_matches('B').trim_end_matches('i');
    if let Some(last) = trimmed.chars().last()
        && last.is_ascii_alphabetic()
    {
        let num_part = &trimmed[..trimmed.len() - last.len_utf8()];
        let base_num = num_part.parse::<f64>().unwrap_or(0.0);
        let step = if from_mode == "si" { 1000.0f64 } else { 1024.0f64 };
        let exp = match last.to_ascii_uppercase() {
            'K' => 1,
            'M' => 2,
            'G' => 3,
            'T' => 4,
            'P' => 5,
            _ => 0,
        };
        base_num * step.powi(exp)
    } else {
        trimmed.parse::<f64>().unwrap_or(0.0)
    }
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
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

fn parse_date_spec(spec: &str) -> i64 {
    let s = spec.trim();
    if let Some(ep) = s.strip_prefix('@') {
        return ep.parse::<i64>().unwrap_or(0);
    }
    let clean = s.trim_end_matches('Z');
    let (date_part, time_part) = clean
        .split_once('T')
        .or_else(|| clean.split_once(' '))
        .unwrap_or((clean, "00:00:00"));
    let dparts: Vec<i64> = date_part.split('-').map(|p| p.parse().unwrap_or(0)).collect();
    let tparts: Vec<i64> = time_part.split(':').map(|p| p.parse().unwrap_or(0)).collect();
    if dparts.len() == 3 {
        let days = days_from_civil(dparts[0], dparts[1], dparts[2]);
        let h = *tparts.first().unwrap_or(&0);
        let m = *tparts.get(1).unwrap_or(&0);
        let sec = *tparts.get(2).unwrap_or(&0);
        return days * 86400 + h * 3600 + m * 60 + sec;
    }
    1700000000
}

fn cmd_date(args: &[String]) -> BuiltinOutcome {
    let mut epoch = 1700000000i64;
    let mut fmt = "%a %b %e %H:%M:%S UTC %Y".to_string();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-u" || a == "--utc" || a == "--universal" {
            i += 1;
        } else if a == "-R" || a == "--rfc-email" || a == "--rfc-2822" {
            fmt = "%a, %d %b %Y %H:%M:%S +0000".to_string();
            i += 1;
        } else if a == "-I" || a == "--iso-8601" || a == "--iso-8601=date" {
            fmt = "%Y-%m-%d".to_string();
            i += 1;
        } else if a == "-Iseconds" || a == "--iso-8601=seconds" {
            fmt = "%Y-%m-%dT%H:%M:%S+00:00".to_string();
            i += 1;
        } else if (a == "-d" || a == "--date") && i + 1 < args.len() {
            epoch = parse_date_spec(&args[i + 1]);
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--date=").or_else(|| a.strip_prefix("-d")) && !rest.is_empty() {
            epoch = parse_date_spec(rest);
            i += 1;
        } else if let Some(f) = a.strip_prefix('+') {
            fmt = f.to_string();
            i += 1;
        } else {
            i += 1;
        }
    }
    let days = epoch.div_euclid(86400);
    let rem = epoch.rem_euclid(86400);
    let hour = (rem / 3600) as u32;
    let min = ((rem % 3600) / 60) as u32;
    let sec = (rem % 60) as u32;
    let (year, month, day) = civil_from_days(days);
    let dow0 = (days + 4).rem_euclid(7) as usize;
    let dow_iso = if dow0 == 0 { 7 } else { dow0 };
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
    let mut doy = day;
    for m in 1..month {
        doy += cal_days_in_month(year.max(0) as u32, m);
    }
    let m_idx = (month.saturating_sub(1) as usize).min(11);
    let mut out = String::with_capacity(fmt.len() + 16);
    let mut chars = fmt.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            match chars.next() {
                Some('%') => out.push('%'),
                Some('Y') => out.push_str(&format!("{year:04}")),
                Some('y') => out.push_str(&format!("{:02}", year.rem_euclid(100))),
                Some('C') => out.push_str(&format!("{:02}", year.div_euclid(100))),
                Some('m') => out.push_str(&format!("{month:02}")),
                Some('d') => out.push_str(&format!("{day:02}")),
                Some('e') => out.push_str(&format!("{day:2}")),
                Some('H') => out.push_str(&format!("{hour:02}")),
                Some('M') => out.push_str(&format!("{min:02}")),
                Some('S') => out.push_str(&format!("{sec:02}")),
                Some('F') => out.push_str(&format!("{year:04}-{month:02}-{day:02}")),
                Some('T') => out.push_str(&format!("{hour:02}:{min:02}:{sec:02}")),
                Some('R') => out.push_str(&format!("{hour:02}:{min:02}")),
                Some('Z') => out.push_str("UTC"),
                Some('z') => out.push_str("+0000"),
                Some('s') => out.push_str(&epoch.to_string()),
                Some('u') => out.push_str(&dow_iso.to_string()),
                Some('w') => out.push_str(&dow0.to_string()),
                Some('j') => out.push_str(&format!("{doy:03}")),
                Some('a') => out.push_str(short_days[dow0]),
                Some('A') => out.push_str(full_days[dow0]),
                Some('b') | Some('h') => out.push_str(short_months[m_idx]),
                Some('B') => out.push_str(full_months[m_idx]),
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some(other) => {
                    out.push('%');
                    out.push(other);
                }
                None => out.push('%'),
            }
        } else {
            out.push(c);
        }
    }
    ok_out(&format!("{out}\n"))
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

fn render_single_cal_month(year: u32, month: u32, monday_first: bool, julian: bool) -> Vec<String> {
    let month_names = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];
    let mname = month_names[(month.clamp(1, 12) - 1) as usize];
    let width = if julian { 27usize } else { 20usize };
    let title = format!("{mname} {year}");
    let pad = width.saturating_sub(title.len()) / 2;
    let mut lines = Vec::new();
    lines.push(format!("{}{title}", " ".repeat(pad)));
    if julian {
        if monday_first {
            lines.push(" Mo  Tu  We  Th  Fr  Sa  Su".to_string());
        } else {
            lines.push(" Su  Mo  Tu  We  Th  Fr  Sa".to_string());
        }
    } else if monday_first {
        lines.push("Mo Tu We Th Fr Sa Su".to_string());
    } else {
        lines.push("Su Mo Tu We Th Fr Sa".to_string());
    }

    if year == 1752 && month == 9 && !julian && !monday_first {
        lines.push("       1  2 14 15 16".to_string());
        lines.push("17 18 19 20 21 22 23".to_string());
        lines.push("24 25 26 27 28 29 30".to_string());
        return lines;
    }

    let first_days = days_from_civil(year as i64, month as i64, 1);
    let dow_sun0 = (first_days + 4).rem_euclid(7) as usize;
    let start_col = if monday_first {
        (dow_sun0 + 6) % 7
    } else {
        dow_sun0
    };
    let days_before: u32 = (1..month).map(|m| cal_days_in_month(year, m)).sum();
    let dim = cal_days_in_month(year, month);
    let cell_w = if julian { 3usize } else { 2usize };
    let mut cells: Vec<String> = Vec::new();
    for _ in 0..start_col {
        cells.push(" ".repeat(cell_w));
    }
    for d in 1..=dim {
        let val = if julian { days_before + d } else { d };
        cells.push(format!("{val:cell_w$}"));
    }
    for row in cells.chunks(7) {
        lines.push(row.join(" "));
    }
    lines
}

fn cmd_cal(args: &[String], env: &BTreeMap<String, String>) -> BuiltinOutcome {
    let mut monday_first = false;
    let mut julian = false;
    let mut three_months = false;
    let mut num_months: usize = 1;
    let mut opt_month: Option<u32> = None;
    let mut pos: Vec<u32> = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-M" {
            monday_first = true;
            i += 1;
        } else if a == "-j" {
            julian = true;
            i += 1;
        } else if a == "-3" {
            three_months = true;
            i += 1;
        } else if a == "-1" || a == "-S" || a == "--span" {
            i += 1;
        } else if a == "-n" && i + 1 < args.len() {
            num_months = args[i + 1].parse().unwrap_or(1);
            i += 2;
        } else if a == "-m" && i + 1 < args.len() {
            opt_month = parse_cal_month_name(&args[i + 1]);
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-m") && !rest.is_empty() {
            opt_month = parse_cal_month_name(rest);
            i += 1;
        } else if let Some(flags) = a.strip_prefix('-') {
            for ch in flags.chars() {
                match ch {
                    'M' => monday_first = true,
                    'j' => julian = true,
                    '3' => three_months = true,
                    _ => {}
                }
            }
            i += 1;
        } else {
            if let Ok(n) = a.parse::<u32>() {
                pos.push(n);
            }
            i += 1;
        }
    }

    let (default_year, default_month) = if let Some(sde) = env.get("SOURCE_DATE_EPOCH")
        && let Ok(sec) = sde.trim().parse::<i64>()
    {
        let (y, m, _) = civil_from_days(sec.div_euclid(86400));
        (y.max(1) as u32, m.clamp(1, 12))
    } else {
        (2024u32, 2u32)
    };

    let (month, year) = match (opt_month, pos.len()) {
        (Some(m), 1) => (m, pos[0]),
        (Some(m), _) => (m, default_year),
        (None, 2) => (pos[0].clamp(1, 12), pos[1]),
        (None, 1) => (1, pos[0]),
        _ => (default_month, default_year),
    };

    if three_months || num_months == 3 {
        let (py, pm) = if month == 1 {
            (year.saturating_sub(1), 12)
        } else {
            (year, month - 1)
        };
        let (ny, nm) = if month == 12 {
            (year + 1, 1)
        } else {
            (year, month + 1)
        };
        let b1 = render_single_cal_month(py, pm, monday_first, julian);
        let b2 = render_single_cal_month(year, month, monday_first, julian);
        let b3 = render_single_cal_month(ny, nm, monday_first, julian);
        let max_r = b1.len().max(b2.len()).max(b3.len());
        let col_w = if julian { 27usize } else { 20usize };
        let mut out = String::new();
        for r in 0..max_r {
            let s1 = b1.get(r).map(|s| s.as_str()).unwrap_or("");
            let s2 = b2.get(r).map(|s| s.as_str()).unwrap_or("");
            let s3 = b3.get(r).map(|s| s.as_str()).unwrap_or("");
            let line = format!("{s1:<col_w$}  {s2:<col_w$}  {s3}");
            out.push_str(line.trim_end());
            out.push('\n');
        }
        return ok_out(&out);
    }

    let lines = render_single_cal_month(year, month, monday_first, julian);
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
                "Usage: getconf [-v specification] variable_name [pathname]\n       getconf -a [pathname]\n",
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
            "Usage: getconf [-v specification] variable_name [pathname]\n       getconf -a [pathname]\n",
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
            return ok_out("Usage: locale [OPTION...] [NAME...]\n");
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
            return ok_out("Usage: pathchk [OPTION]... NAME...\n");
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

fn cmd_hostname(args: &[String], env: &BTreeMap<String, String>, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let full = resolve_effective_hostname(env, fs);
    for a in args {
        match a.as_str() {
            "-s" | "--short" => {
                let short = full.split('.').next().unwrap_or(&full);
                return ok_out(&format!("{short}\n"));
            }
            "-d" | "--domain" => {
                let dom = full.split_once('.').map(|(_, d)| d).unwrap_or("");
                return ok_out(&format!("{dom}\n"));
            }
            "-i" | "--ip-address" | "-I" | "--all-ip-addresses" => {
                return ok_out("127.0.0.1\n");
            }
            "-f" | "--fqdn" | "--long" => {
                return ok_out(&format!("{full}\n"));
            }
            _ => {}
        }
    }
    ok_out(&format!("{full}\n"))
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
            return ok_out("Usage: nproc [OPTION]...\n");
        } else if !ended && a == "--version" {
            return ok_out("nproc (Sandbox VFS-ish/GNU coreutils) 9.7\n");
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
            return ok_out("Usage: uname [OPTION]...\n");
        }
        if !ended && a == "--version" {
            return ok_out("uname (Sandbox VFS-ish/GNU coreutils) 9.7\n");
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
            return ok_out("Usage: id [OPTION]... [USER]...\n");
        }
        if a == "--version" {
            return ok_out("id (Sandbox VFS-ish/GNU coreutils) 9.7\n");
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
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
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
        !number_lines && !squeeze_blank && start_line == 1 && start_pat.is_none();
    let mut texts: Vec<String> = Vec::new();
    let mut out = String::new();
    let mut err_buf = String::new();
    let mut exit_code = 0;
    let mut stdin_used = false;

    for file in &files {
        if file == "-" {
            let chunk = if stdin_used {
                ""
            } else {
                stdin_used = true;
                stdin
            };
            if pass_through {
                out.push_str(chunk);
            } else {
                texts.push(chunk.to_string());
            }
        } else {
            let path = resolve_posix_path(cwd, file);
            match fs.read_file(&path) {
                Ok(bytes) => {
                    if pass_through {
                        out.push_str(&crate::vfs::bytes_to_stream_string(&bytes));
                    } else {
                        texts.push(String::from_utf8_lossy(&bytes).into_owned());
                    }
                }
                Err(e) => {
                    err_buf.push_str(&format!("{cmd}: {file}: {e}\n"));
                    exit_code = 1;
                }
            }
        }
    }

    if pass_through {
        return BuiltinOutcome {
            stdout: out,
            stderr: err_buf,
            exit_code,
        };
    }

    let combined = texts.join("");
    if combined.is_empty() {
        return BuiltinOutcome {
            stdout: out,
            stderr: err_buf,
            exit_code,
        };
    }

    let has_trailing_newline = combined.ends_with('\n');
    let mut raw_lines: Vec<&str> = combined.split('\n').collect();
    if has_trailing_newline {
        raw_lines.pop();
    }

    let mut start_idx = start_line.saturating_sub(1);
    if let Some(ref pat) = start_pat
        && !pat.is_empty()
    {
        let rx = crate::commands::search::ZeroRegex::new(
            vec![pat.to_string()],
            ignore_case,
            false,
            false,
            false,
        );
        if let Some(found) = raw_lines.iter().position(|l| rx.is_match(l)) {
            start_idx = found;
        }
    }

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
    BuiltinOutcome {
        stdout: out,
        stderr: err_buf,
        exit_code,
    }
}

fn cmd_factor(args: &[String], stdin: &str) -> BuiltinOutcome {
    let nums: Vec<String> = if args.is_empty() {
        stdin.split_whitespace().map(|s| s.to_string()).collect()
    } else {
        args.to_vec()
    };
    let mut out = String::new();
    for ns in nums {
        let Ok(mut n) = ns.parse::<u64>() else {
            continue;
        };
        let orig = n;
        let mut factors = Vec::new();
        let mut d = 2u64;
        while d * d <= n {
            while n.is_multiple_of(d) {
                factors.push(d.to_string());
                n /= d;
            }
            d += 1;
        }
        if n > 1 {
            factors.push(n.to_string());
        }
        if factors.is_empty() {
            out.push_str(&format!("{orig}:\n"));
        } else {
            out.push_str(&format!("{orig}: {}\n", factors.join(" ")));
        }
    }
    ok_out(&out)
}

fn fold_char_width(cp: u32) -> usize {
    if cp == 0 {
        return 0;
    }
    if cp < 32 || (cp >= 0x7f && cp < 0xa0) {
        return 0;
    }
    if (0x0300..=0x036f).contains(&cp)
        || (0x1ab0..=0x1aff).contains(&cp)
        || (0x1dc0..=0x1dff).contains(&cp)
        || (0x20d0..=0x20ff).contains(&cp)
        || (0xfe00..=0xfe0f).contains(&cp)
        || (0xfe20..=0xfe2f).contains(&cp)
        || (0xe0100..=0xe01ef).contains(&cp)
        || (0x200b..=0x200f).contains(&cp)
        || (0x2060..=0x206f).contains(&cp)
        || cp == 0xfeff
    {
        return 0;
    }
    if (0x1100..=0x115f).contains(&cp)
        || cp == 0x2329
        || cp == 0x232a
        || (0x2e80..=0xa4cf).contains(&cp)
        || (0xac00..=0xd7a3).contains(&cp)
        || (0xf900..=0xfaff).contains(&cp)
        || (0xfe10..=0xfe19).contains(&cp)
        || (0xfe30..=0xfe6f).contains(&cp)
        || (0xff01..=0xff60).contains(&cp)
        || (0xffe0..=0xffe6).contains(&cp)
        || (0x1f300..=0x1faff).contains(&cp)
        || (0x20000..=0x3fffd).contains(&cp)
    {
        return 2;
    }
    1
}

fn decode_fold_unit(bytes: &[u8], offset: usize, utf8: bool) -> (u32, usize, bool) {
    if !utf8 || offset >= bytes.len() {
        let b = bytes.get(offset).copied().unwrap_or(0);
        return (b as u32, 1, b < 128);
    }
    let b0 = bytes[offset];
    if b0 < 0x80 {
        return (b0 as u32, 1, true);
    }
    let rem = &bytes[offset..];
    if (0xc2..=0xdf).contains(&b0) && rem.len() >= 2 && (rem[1] & 0xc0) == 0x80 {
        let cp = (((b0 & 0x1f) as u32) << 6) | ((rem[1] & 0x3f) as u32);
        return (cp, 2, true);
    }
    if (0xe0..=0xef).contains(&b0)
        && rem.len() >= 3
        && (rem[1] & 0xc0) == 0x80
        && (rem[2] & 0xc0) == 0x80
    {
        let cp = (((b0 & 0x0f) as u32) << 12)
            | (((rem[1] & 0x3f) as u32) << 6)
            | ((rem[2] & 0x3f) as u32);
        if cp >= 0x800 && !(0xd800..=0xdfff).contains(&cp) {
            return (cp, 3, true);
        }
    }
    if (0xf0..=0xf4).contains(&b0)
        && rem.len() >= 4
        && (rem[1] & 0xc0) == 0x80
        && (rem[2] & 0xc0) == 0x80
        && (rem[3] & 0xc0) == 0x80
    {
        let cp = (((b0 & 0x07) as u32) << 18)
            | (((rem[1] & 0x3f) as u32) << 12)
            | (((rem[2] & 0x3f) as u32) << 6)
            | ((rem[3] & 0x3f) as u32);
        if (0x10000..=0x10ffff).contains(&cp) {
            return (cp, 4, true);
        }
    }
    (b0 as u32, 1, false)
}

fn parse_fold_width(val: &str) -> Result<usize, String> {
    let trimmed = val.trim_start_matches([' ', '\t', '\r', '\n', '\x0b', '\x0c']);
    let digits = trimmed.strip_prefix('+').unwrap_or(trimmed);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("fold: invalid number of columns: '{val}'\n"));
    }
    match digits.parse::<usize>() {
        Ok(n) if n >= 1 => Ok(n),
        _ => Err(format!("fold: invalid number of columns: '{val}'\n")),
    }
}

fn cmd_fold(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    if args.len() == 1 && (args[0] == "--help" || args[0] == "--version") {
        return ok_out(if args[0] == "--help" {
            "Usage: fold [OPTION]... [FILE]...\n"
        } else {
            "fold (safe-bash) 0.0.1\n"
        });
    }
    let mut width = 80usize;
    let mut break_spaces = false;
    let mut mode = "columns";
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            files.extend(args[i + 1..].iter().cloned());
            break;
        } else if a == "-" || !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
        } else if let Some(rest) = a.strip_prefix("--") {
            let (name, eq_val) = match rest.split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (rest, None),
            };
            let matches: Vec<&str> = ["bytes", "characters", "spaces", "width"]
                .into_iter()
                .filter(|cand| !name.is_empty() && cand.starts_with(name))
                .collect();
            if matches.len() != 1 {
                return err_out(&format!("fold: unrecognized option '{a}'\n"), 1);
            }
            match matches[0] {
                "width" => {
                    let val = if let Some(v) = eq_val {
                        v
                    } else if i + 1 < args.len() {
                        i += 1;
                        &args[i]
                    } else {
                        return err_out("fold: option '--width' requires an argument\n", 1);
                    };
                    width = match parse_fold_width(val) {
                        Ok(w) => w,
                        Err(msg) => return err_out(&msg, 1),
                    };
                }
                other => {
                    if eq_val.is_some() {
                        return err_out(
                            &format!("fold: option '--{other}' doesn't allow an argument\n"),
                            1,
                        );
                    }
                    match other {
                        "spaces" => break_spaces = true,
                        "bytes" => mode = "bytes",
                        "characters" => mode = "characters",
                        _ => {}
                    }
                }
            }
            i += 1;
        } else {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                match chars[ci] {
                    'b' => {
                        mode = "bytes";
                        ci += 1;
                    }
                    'c' => {
                        mode = "characters";
                        ci += 1;
                    }
                    's' => {
                        break_spaces = true;
                        ci += 1;
                    }
                    'w' => {
                        let inline: String = chars[ci + 1..].iter().collect();
                        let val = if !inline.is_empty() {
                            inline
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return err_out("fold: option requires an argument -- 'w'\n", 1);
                        };
                        width = match parse_fold_width(&val) {
                            Ok(w) => w,
                            Err(msg) => return err_out(&msg, 1),
                        };
                        break;
                    }
                    ch if ch.is_ascii_digit() => {
                        let inline: String = chars[ci..].iter().collect();
                        width = match parse_fold_width(&inline) {
                            Ok(w) => w,
                            Err(msg) => return err_out(&msg, 1),
                        };
                        break;
                    }
                    ch => {
                        return err_out(&format!("fold: invalid option -- '{ch}'\n"), 1);
                    }
                }
            }
            i += 1;
        }
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

    let adjust_col = |col: usize, cp: u32, unit_len: usize, valid: bool| -> usize {
        if mode == "bytes" {
            col + unit_len
        } else if cp == 8 {
            col.saturating_sub(1)
        } else if cp == 13 {
            0
        } else if cp == 9 {
            col + (8 - col % 8)
        } else if mode == "characters" {
            col + 1
        } else if utf8 && valid {
            col + fold_char_width(cp)
        } else {
            col + 1
        }
    };

    let inputs = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut exit_code = 0;

    for f in &inputs {
        let raw_in = if f == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let p = resolve_posix_path(cwd, f);
            if fs.is_dir(&p) {
                stderr.push_str(&format!("fold: {f}: Is a directory\n"));
                exit_code = 1;
                continue;
            }
            match fs.read_file(&p) {
                Ok(b) => b,
                Err(_) => {
                    stderr.push_str(&format!("fold: {f}: No such file or directory\n"));
                    exit_code = 1;
                    continue;
                }
            }
        };

        let mut line_buf: Vec<u8> = Vec::new();
        let mut col = 0usize;
        let mut last_blank: Option<usize> = None;
        let mut off = 0usize;
        while off < raw_in.len() {
            if raw_in[off] == b'\n' {
                out_bytes.extend_from_slice(&line_buf);
                out_bytes.push(b'\n');
                line_buf.clear();
                col = 0;
                last_blank = None;
                off += 1;
                continue;
            }
            let (cp, ulen, valid) = decode_fold_unit(&raw_in, off, utf8);
            let unit_slice = &raw_in[off..off + ulen];
            off += ulen;

            while adjust_col(col, cp, ulen, valid) > width && !line_buf.is_empty() {
                if break_spaces && let Some(lb) = last_blank {
                    out_bytes.extend_from_slice(&line_buf[..lb]);
                    out_bytes.push(b'\n');
                    line_buf.drain(..lb);
                    col = 0;
                    last_blank = None;
                    let mut roff = 0usize;
                    while roff < line_buf.len() {
                        let (rcp, rulen, rvalid) = decode_fold_unit(&line_buf, roff, utf8);
                        col = adjust_col(col, rcp, rulen, rvalid);
                        roff += rulen;
                        if rcp == 32 || rcp == 9 {
                            last_blank = Some(roff);
                        }
                    }
                } else {
                    out_bytes.extend_from_slice(&line_buf);
                    out_bytes.push(b'\n');
                    line_buf.clear();
                    col = 0;
                    last_blank = None;
                }
            }
            col = adjust_col(col, cp, ulen, valid);
            line_buf.extend_from_slice(unit_slice);
            if break_spaces && (cp == 32 || cp == 9) {
                last_blank = Some(line_buf.len());
            }
        }
        if !line_buf.is_empty() {
            out_bytes.extend_from_slice(&line_buf);
        }
    }

    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        stderr,
        exit_code,
    }
}

fn parse_fmt_width_val(text: &str, max_val: usize) -> Result<usize, String> {
    let trimmed = text.trim_start_matches([' ', '\t', '\r', '\n', '\x0b', '\x0c']);
    let digits = trimmed.strip_prefix('+').unwrap_or(trimmed);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("fmt: invalid width: '{text}'\n"));
    }
    match digits.parse::<usize>() {
        Ok(n) if n <= max_val => Ok(n),
        _ => Err(format!("fmt: invalid width: '{text}'\n")),
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
    input: &'a [u8],
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
    fn read(&mut self) -> i32 {
        if self.pos < self.input.len() {
            let b = self.input[self.pos] as i32;
            self.pos += 1;
            b
        } else {
            -1
        }
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

    fn whitespace(&mut self, mut byte: i32) -> i32 {
        while byte == 32 || byte == 9 {
            if byte == 32 {
                self.column += 1;
            } else {
                self.tabs = true;
                self.column = (self.column / 8 + 1) * 8;
            }
            byte = self.read();
        }
        byte
    }

    fn line_start(&mut self) -> i32 {
        self.column = 0;
        let first = self.read();
        let mut byte = self.whitespace(first);
        self.next_prefix = if !self.prefix.is_empty() {
            self.column
        } else {
            self.leading.min(self.column)
        };
        if !self.prefix.is_empty() {
            for i in 0..self.prefix.len() {
                let expected = self.prefix[i] as i32;
                if byte != expected {
                    return byte;
                }
                self.column += 1;
                byte = self.read();
            }
            byte = self.whitespace(byte);
        }
        byte
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

    fn read_line(&mut self, mut byte: i32) -> i32 {
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
                    self.text.resize(self.text.len() * 2, 0);
                }
                self.text[self.used] = byte as u8;
                self.used += 1;
                byte = self.read();
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
            byte = self.whitespace(byte);
            word.space = self.column - before;
            word.final_word = byte == -1 || (word.period && (byte == 10 || word.space > 1));
            if byte == 10 || byte == -1 || self.uniform {
                word.space = if word.final_word { 2 } else { 1 };
            }
            self.words.push(word);
            if byte == -1 || byte == 10 {
                break;
            }
        }
        self.line_start()
    }

    fn run(&mut self) {
        let mut byte = self.line_start();
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
                    byte = self.read();
                }
                if byte == -1 {
                    break;
                }
                self.out.push(b'\n');
                byte = self.line_start();
                continue;
            }
            self.last_length = 0;
            self.prefix_indent = self.next_prefix;
            self.first_indent = self.column;
            self.words.clear();
            self.used = 0;
            byte = self.read_line(byte);
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
                        byte = self.read_line(byte);
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
    }
}

fn cmd_fmt(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
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
            "help" => return Ok(Some(ok_out("Usage: fmt [-WIDTH] [OPTION]... [FILE]...\n"))),
            "version" => return Ok(Some(ok_out("fmt (safe-bash)\n"))),
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
            let (_, key) = if let Some(&pair) = exact {
                pair
            } else if matches.len() == 1 {
                *matches[0]
            } else {
                return err_out(&format!("fmt: unrecognized option '{a}'\n"), 1);
            };
            let val = if matches!(key, "p" | "w" | "g") {
                if let Some(v) = eq_val {
                    Some(v.to_string())
                } else if i + 1 < args.len() {
                    i += 1;
                    Some(args[i].clone())
                } else {
                    return err_out(&format!("fmt: option '{a}' requires an argument\n"), 1);
                }
            } else {
                if eq_val.is_some() {
                    return err_out(&format!("fmt: option '{a}' doesn't allow an argument\n"), 1);
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
                        &format!("fmt: invalid option -- {ch}; -WIDTH is recognized only when it is the first\noption; use -w N instead\n"),
                        1,
                    );
                }
                if !"cstuwpg".contains(ch) {
                    return err_out(&format!("fmt: invalid option -- '{ch}'\n"), 1);
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
                        return err_out(&format!("fmt: option requires an argument -- '{ch}'\n"), 1);
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
        width = match parse_fmt_width_val(w_str, 2500) {
            Ok(w) => w,
            Err(msg) => return err_out(&msg, 1),
        };
    }
    let goal = if let Some(ref g_str) = goal_opt {
        let g = match parse_fmt_width_val(g_str, width) {
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
    let mut combined: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut exit_code = 0;
    for f in &inputs {
        if f == "-" {
            combined.extend_from_slice(&crate::vfs::stream_string_to_bytes(stdin));
        } else {
            let p = resolve_posix_path(cwd, f);
            if fs.is_dir(&p) {
                stderr.push_str(&format!("fmt: read error\n"));
                exit_code = 1;
                continue;
            }
            match fs.read_file(&p) {
                Ok(b) => combined.extend_from_slice(&b),
                Err(_) => {
                    stderr.push_str(&format!("fmt: cannot open '{f}' for reading: No such file or directory\n"));
                    exit_code = 1;
                }
            }
        }
    }

    let mut formatter = FmtFormatter {
        input: &combined,
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
        prefix: prefix_bytes,
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
    formatter.run();

    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&formatter.out),
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
                return err_out(&format!("csplit: unrecognized option '{a}'\n"), 1);
            };
            let val = if matches!(key, "f" | "b" | "n") {
                if let Some(v) = eq_val {
                    Some(v.to_string())
                } else if i + 1 < args.len() {
                    i += 1;
                    Some(args[i].clone())
                } else {
                    return err_out(
                        &format!("csplit: option '--{sel_name}' requires an argument\n"),
                        1,
                    );
                }
            } else {
                if eq_val.is_some() {
                    return err_out(
                        &format!("csplit: option '--{sel_name}' doesn't allow an argument\n"),
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
                "help" => return ok_out("Usage: csplit [OPTION]... FILE PATTERN...\n"),
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
                    return err_out(&format!("csplit: invalid option -- '{ch}'\n"), 1);
                }
                if "fbn".contains(ch) {
                    let inline: String = chars[ci + 1..].iter().collect();
                    let val = if !inline.is_empty() {
                        inline
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out(&format!("csplit: option requires an argument -- '{ch}'\n"), 1);
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

    if operands.len() < 2 {
        return err_out("csplit: missing operand\n", 1);
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
    let text = match read_inputs_or_stdin(std::slice::from_ref(input_file), stdin, cwd, fs, "csplit")
    {
        Ok(t) => t,
        Err(e) => return e,
    };
    let lines: Vec<&str> = text.split_inclusive('\n').collect();

    let mut next_line = 1usize;
    let mut current_line = 0usize;
    let mut cur_piece: Vec<u8> = Vec::new();
    let mut piece_open = false;
    let mut created_files: Vec<String> = Vec::new();
    let mut file_no = 0usize;
    let mut stdout = String::new();

    let finish_piece = |piece: &mut Vec<u8>,
                            open: &mut bool,
                            created: &mut Vec<String>,
                            f_no: &mut usize,
                            out: &mut String| {
        if !*open {
            return;
        }
        *open = false;
        if elide && piece.is_empty() {
            piece.clear();
            return;
        }
        let suf = suffix_fn(*f_no);
        *f_no += 1;
        let fname = format!("{prefix}{suf}");
        let full = resolve_posix_path(cwd, &fname);
        let _ = fs.write_file(&full, piece);
        created.push(full);
        if !quiet {
            out.push_str(&format!("{}\n", piece.len()));
        }
        piece.clear();
    };

    let remove_line = |next_l: &mut usize, cur_l: &mut usize| -> Option<&'static str> {
        let _ = (next_l, cur_l);
        None
    };
    let _ = remove_line;

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
                            finish_piece(
                                &mut cur_piece,
                                &mut piece_open,
                                &mut created_files,
                                &mut file_no,
                                &mut stdout,
                            );
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
                    finish_piece(
                        &mut cur_piece,
                        &mut piece_open,
                        &mut created_files,
                        &mut file_no,
                        &mut stdout,
                    );
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
                finish_piece(
                    &mut cur_piece,
                    &mut piece_open,
                    &mut created_files,
                    &mut file_no,
                    &mut stdout,
                );
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

    if let Some(err) = fail_msg {
        finish_piece(
            &mut cur_piece,
            &mut piece_open,
            &mut created_files,
            &mut file_no,
            &mut stdout,
        );
        if !keep {
            for f in &created_files {
                let _ = fs.remove(f, false);
            }
        }
        stderr.push_str(&err);
        return BuiltinOutcome {
            stdout,
            stderr,
            exit_code: 1,
        };
    }

    if !forever_done {
        piece_open = true;
        while next_line <= lines.len() {
            cur_piece.extend_from_slice(&crate::vfs::stream_string_to_bytes(lines[next_line - 1]));
            current_line = current_line.max(next_line);
            next_line += 1;
        }
        finish_piece(
            &mut cur_piece,
            &mut piece_open,
            &mut created_files,
            &mut file_no,
            &mut stdout,
        );
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
        _ => Err(format!("pr: {label}: '{val}'\n")),
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

struct PrReader {
    data: Vec<u8>,
    pos: usize,
    pushed: Option<i32>,
}

impl PrReader {
    fn new(data: Vec<u8>) -> Self {
        Self {
            data,
            pos: 0,
            pushed: None,
        }
    }
    fn get(&mut self) -> i32 {
        if let Some(b) = self.pushed.take() {
            return b;
        }
        if self.pos < self.data.len() {
            let b = self.data[self.pos] as i32;
            self.pos += 1;
            b
        } else {
            -1
        }
    }
    fn unget(&mut self, b: i32) {
        if b >= 0 {
            self.pushed = Some(b);
        }
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
    rendered: String,
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
            rendered: String::new(),
        })
    }

    fn append(&mut self, val: &str) {
        if self.page_number < self.opts.first_page {
            return;
        }
        self.rendered.push_str(val);
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
        let s = ch.to_string();
        self.append(&s);
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

    fn feed_col(&mut self, col_idx: usize, readers: &mut [PrReader]) {
        let r_idx = self.columns[col_idx].reader_idx;
        let next = readers[r_idx].get();
        if next != 10 {
            readers[r_idx].unget(next);
        }
        self.hold_col(col_idx);
    }

    fn rest_col(&mut self, col_idx: usize, readers: &mut [PrReader]) {
        let r_idx = self.columns[col_idx].reader_idx;
        loop {
            let r = readers[r_idx].get();
            if r == 10 {
                return;
            }
            if r == 12 {
                self.feed_col(col_idx, readers);
                if self.opts.keep_ff {
                    self.print_feed = true;
                }
                return;
            }
            if r < 0 {
                self.close_col(col_idx);
                return;
            }
        }
    }

    fn header(&mut self, date: &str, name: &str) {
        self.output_position = 0;
        self.pad(self.opts.margin);
        self.white();
        let print_w = |s: &str| s.chars().filter(|&c| c >= ' ' && c != '\x7f').count();
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
    }

    fn read_col(&mut self, col_idx: usize, readers: &mut [PrReader], date: &str, name: &str) {
        let r_idx = self.columns[col_idx].reader_idx;
        let mut byte = readers[r_idx].get();
        if byte == 12 && self.columns[col_idx].full {
            byte = readers[r_idx].get();
            if byte == 10 {
                byte = readers[r_idx].get();
            }
        }
        self.columns[col_idx].full = false;
        if byte == 12 {
            self.feed_col(col_idx, readers);
            self.feed_only = true;
            if self.need_header && !self.store {
                self.vertical = true;
                self.header(date, name);
            } else if self.opts.keep_ff {
                self.print_feed = true;
            }
            return;
        }
        if byte < 0 {
            self.close_col(col_idx);
            return;
        }
        let mut clump = if byte == 10 {
            String::new()
        } else {
            self.clump(byte as u8)
        };
        if self.opts.truncate && self.input_position > self.column_width {
            self.input_position = 0;
            self.rest_col(col_idx, readers);
            return;
        }
        if !self.storing {
            self.vertical = true;
            if self.need_header && !self.store {
                self.header(date, name);
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
            return;
        }
        for ch in clump.chars() {
            self.character(ch);
        }
        loop {
            let rn = readers[r_idx].get();
            if rn == 10 {
                return;
            }
            if rn == 12 {
                self.feed_col(col_idx, readers);
                if self.opts.keep_ff {
                    self.print_feed = true;
                }
                return;
            }
            if rn < 0 {
                self.close_col(col_idx);
                return;
            }
            let prev = self.input_position;
            clump = self.clump(rn as u8);
            if self.opts.truncate && self.input_position > self.column_width {
                self.input_position = prev;
                self.rest_col(col_idx, readers);
                return;
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

    fn stored_line(&mut self, col_idx: usize, date: &str, name: &str) {
        self.vertical = true;
        if self.need_header {
            self.header(date, name);
        }
        if self.columns[col_idx].status == PrColStatus::Feed {
            for c in &mut self.columns {
                c.status = PrColStatus::Held;
            }
            if self.columns[0].remaining == 0 {
                if !self.opts.extremities {
                    self.vertical = false;
                }
                return;
            }
        }
        let cur = self.columns[col_idx].current;
        self.columns[col_idx].current += 1;
        let Some(line) = self.columns[col_idx].lines.get(cur).cloned() else {
            return;
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
    }

    fn run(&mut self, readers: &mut [PrReader], date: &str, name: &str) {
        let count = if self.opts.merge {
            readers.len()
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
                reader_idx: if self.opts.merge { idx } else { 0 },
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
                        self.read_col(col_idx, readers, date, name);
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
                            self.stored_line(col_idx, date, name);
                        } else {
                            self.read_col(col_idx, readers, date, name);
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
                    break;
                }
                if self.opts.double_space && printed {
                    self.append("\n");
                    left = left.saturating_sub(1);
                }
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
            self.page_number += 1;
            for col in &mut self.columns {
                if col.status == PrColStatus::Held {
                    col.status = PrColStatus::Open;
                }
            }
        }
    }
}

fn cmd_pr(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
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
                "Usage: pr [OPTION]... [FILE]...\n"
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
            } else {
                return err_out(&format!("pr: unrecognized option '{argument}'\n"), 1);
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
                        return err_out(
                            &format!("pr: option requires an argument -- '{option}'\n"),
                            1,
                        );
                    }
                }
                offset = sw_chars.len();
            } else if attached.is_some() {
                return err_out("pr: option doesn't allow an argument\n", 1);
            } else {
                offset += 1;
            }

            match option {
                'p' => {
                    if !is_long {
                        return err_out("pr: invalid option -- 'p'\n", 1);
                    }
                    if let Err(msg) = parse_pr_pages(&value.unwrap_or_default(), &mut opts) {
                        return err_out(&msg, 1);
                    }
                }
                '\0' => {}
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
                                Err(msg) => return err_out(&msg, 1),
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
                _ => return err_out(&format!("pr: invalid option -- '{option}'\n"), 1),
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

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit_code = 0;
    let date_str = "2026-01-01 00:00";

    for group in groups {
        let mut formatter = match PrFormatter::new(opts.clone(), group.len()) {
            Ok(f) => f,
            Err(msg) => return err_out(&msg, 1),
        };
        let mut readers: Vec<PrReader> = Vec::new();
        let mut first_name = String::new();
        for name in &group {
            if name == "-" {
                if first_name.is_empty() {
                    first_name = "-".to_string();
                }
                readers.push(PrReader::new(crate::vfs::stream_string_to_bytes(stdin)));
            } else {
                let p = resolve_posix_path(cwd, name);
                if fs.is_dir(&p) {
                    exit_code = 1;
                    if !opts.quiet {
                        stderr.push_str(&format!("pr: {name}: Is a directory\n"));
                    }
                    continue;
                }
                match fs.read_file(&p) {
                Ok(b) => {
                        if first_name.is_empty() {
                            first_name = name.clone();
                        }
                        readers.push(PrReader::new(b));
                    }
                    Err(_) => {
                        exit_code = 1;
                        if !opts.quiet {
                            stderr.push_str(&format!(
                                "pr: {name}: No such file or directory\n"
                            ));
                        }
                    }
                }
            }
        }
        if readers.is_empty() {
            continue;
        }
        let title = opts.header.clone().unwrap_or_else(|| {
            if opts.merge || first_name == "-" {
                String::new()
            } else {
                first_name
            }
        });
        formatter.run(&mut readers, date_str, &title);
        stdout.push_str(&formatter.rendered);
    }

    BuiltinOutcome {
        stdout,
        stderr,
        exit_code,
    }
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
            let entries: Vec<&str> = spec.split([',', ' ', '\t']).filter(|s| !s.is_empty()).collect();
            if entries.is_empty() {
                return Err(format!("{cmd_name}: tab size cannot be 0\n"));
            }
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
                if num_str.is_empty() || !num_str.bytes().all(|b| b.is_ascii_digit()) {
                    return Err(format!("{cmd_name}: tab size contains invalid character(s): '{entry}'\n"));
                }
                let n = match num_str.parse::<usize>() {
                    Ok(v) => v,
                    Err(_) => return Err(format!("{cmd_name}: tab stop is too large '{entry}'\n")),
                };
                if marker.is_none() && n == 0 {
                    return Err(format!("{cmd_name}: tab size cannot be 0\n"));
                }
                match marker {
                    Some('+') => {
                        if rel_repeat != 0 || abs_repeat != 0 {
                            return Err(format!("{cmd_name}: '+' specifier only allowed with the last value\n"));
                        }
                        rel_repeat = n;
                    }
                    Some('/') => {
                        if abs_repeat != 0 || rel_repeat != 0 {
                            return Err(format!("{cmd_name}: '/' specifier only allowed with the last value\n"));
                        }
                        abs_repeat = n;
                    }
                    _ => {
                        if rel_repeat != 0 || abs_repeat != 0 {
                            return Err(format!("{cmd_name}: repeating tab stop must be last\n"));
                        }
                        if n <= stops.last().copied().unwrap_or(0) {
                            return Err(format!("{cmd_name}: tab sizes must be ascending\n"));
                        }
                        stops.push(n);
                    }
                }
            }
        }
        if abs_repeat != 0 && rel_repeat != 0 {
            return Err(format!("{cmd_name}: '/' specifier is mutually exclusive with '+'\n"));
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

fn cmd_expand(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut tab_specs: Vec<String> = Vec::new();
    let mut initial_only = false;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            files.extend(args[i + 1..].iter().cloned());
            break;
        } else if a == "-i" || a == "--initial" {
            initial_only = true;
            i += 1;
        } else if (a == "-t" || a == "--tabs") && i + 1 < args.len() {
            tab_specs.push(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-t").or_else(|| a.strip_prefix("--tabs="))
            && !rest.is_empty()
        {
            tab_specs.push(rest.to_string());
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 && a[1..].chars().all(|c| c.is_ascii_digit() || c == ',') {
            tab_specs.push(a[1..].to_string());
            i += 1;
        } else if !a.starts_with('-') || a == "-" {
            files.push(a.clone());
            i += 1;
        } else {
            return err_out(&format!("expand: invalid option -- '{a}'\n"), 1);
        }
    }
    let tabs = match ParsedTabs::parse(&tab_specs, "expand") {
        Ok(t) => t,
        Err(msg) => return err_out(&msg, 1),
    };
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "expand") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let raw_in = crate::vfs::stream_string_to_bytes(&text);
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut column = 0usize;
    let mut initial = true;
    for &b in &raw_in {
        if b == b'\t' && (!initial_only || initial) {
            let stop = tabs.next_stop(column, true).unwrap_or(column + 1);
            while column < stop {
                out_bytes.push(b' ');
                column += 1;
            }
        } else {
            out_bytes.push(b);
            if b == b'\n' {
                column = 0;
                initial = true;
            } else {
                column = if b == 8 { column.saturating_sub(1) } else { column + 1 };
                if b != b' ' && b != b'\t' {
                    initial = false;
                }
            }
        }
    }
    ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
}

fn cmd_unexpand(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut tab_specs: Vec<String> = Vec::new();
    let mut all_flag = false;
    let mut has_t = false;
    let mut first_only = false;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            files.extend(args[i + 1..].iter().cloned());
            break;
        } else if a == "-a" || a == "--all" {
            all_flag = true;
            i += 1;
        } else if a == "--first-only" {
            first_only = true;
            i += 1;
        } else if (a == "-t" || a == "--tabs") && i + 1 < args.len() {
            tab_specs.push(args[i + 1].clone());
            has_t = true;
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-t").or_else(|| a.strip_prefix("--tabs="))
            && !rest.is_empty()
        {
            tab_specs.push(rest.to_string());
            has_t = true;
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 && a[1..].chars().all(|c| c.is_ascii_digit() || c == ',') {
            tab_specs.push(a[1..].to_string());
            has_t = true;
            i += 1;
        } else if !a.starts_with('-') || a == "-" {
            files.push(a.clone());
            i += 1;
        } else {
            return err_out(&format!("unexpand: invalid option -- '{a}'\n"), 1);
        }
    }
    let tabs = match ParsedTabs::parse(&tab_specs, "unexpand") {
        Ok(t) => t,
        Err(msg) => return err_out(&msg, 1),
    };
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "unexpand") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let all = !first_only && (all_flag || has_t);
    let raw_in = crate::vfs::stream_string_to_bytes(&text);
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut column = 0usize;
    let mut initial = true;
    let mut active = true;
    let mut pending_start = 0usize;
    let mut pending_count = 0usize;
    let mut pending_tab = false;

    let flush_blanks = |out: &mut Vec<u8>,
                        pending_start: usize,
                        column: usize,
                        initial: bool,
                        pending_count: &mut usize,
                        pending_tab: &mut bool| {
        if *pending_count == 0 {
            return;
        }
        let convert_single = initial || *pending_count > 1 || *pending_tab;
        let mut pos = pending_start;
        while pos < column {
            if let Some(stop) = tabs.next_stop(pos, false)
                && stop <= column
                && (stop - pos > 1 || convert_single)
            {
                out.push(b'\t');
                pos = stop;
            } else {
                out.push(b' ');
                pos += 1;
            }
        }
        *pending_count = 0;
        *pending_tab = false;
    };

    for &b in &raw_in {
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
            flush_blanks(
                &mut out_bytes,
                pending_start,
                column,
                initial,
                &mut pending_count,
                &mut pending_tab,
            );
            active = false;
        } else if pending_count > 0 {
            flush_blanks(
                &mut out_bytes,
                pending_start,
                column,
                initial,
                &mut pending_count,
                &mut pending_tab,
            );
        }
        out_bytes.push(b);
        if b == b'\n' {
            column = 0;
            initial = true;
            active = true;
        } else if active {
            column = if b == 8 { column.saturating_sub(1) } else { column + 1 };
            initial = false;
            if !all {
                active = false;
            }
        }
    }
    flush_blanks(
        &mut out_bytes,
        pending_start,
        column,
        initial,
        &mut pending_count,
        &mut pending_tab,
    );
    ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
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
            return Err(format!("column: undefined column name '{val}'\n"));
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
            let maximum = stats[&idx].maximum;
            let add = if maximum > 0 {
                (opts.width - total).min(maximum.saturating_sub(widths[idx]))
            } else {
                opts.width - total
            };
            widths[idx] += add;
            total += add;
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
                    return Err("column: input separator must not be empty\n".to_string());
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
                        "column: column names must be nonempty and contain no NUL\n".to_string(),
                    );
                }
                opts.names = names;
            }
            "n" => {
                if value.is_empty() || value.contains('\0') {
                    return Err(
                        "column: table name must be nonempty and contain no NUL\n".to_string(),
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
                    return Err("column: invalid columns limit\n".to_string());
                }
                let n = value.parse::<usize>().unwrap_or(0);
                if n < 1 {
                    return Err("column: invalid columns limit\n".to_string());
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
                        return Err(format!("column: unsupported column property: {prop}\n"));
                    }
                }
                opts.definitions.push(ColDef { name, named, flags });
            }
            _ => {
                if value.is_empty() || !value.chars().all(|c| c.is_ascii_digit()) {
                    return Err("column: invalid output width\n".to_string());
                }
                let w = value.parse::<usize>().unwrap_or(0);
                if w < 1 {
                    return Err("column: invalid output width\n".to_string());
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
                return err_out(&format!("column: unsupported option: {token}\n"), 1);
            };
            let value = if let Some(v) = attached {
                v
            } else if index + 1 < args.len() {
                index += 1;
                args[index].clone()
            } else {
                return err_out(&format!("column: option {name} requires an argument\n"), 1);
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
                            &format!("column: option -{ch} requires an argument\n"),
                            1,
                        );
                    };
                    if let Err(msg) = set_value(&mut opts, &mut output_set, &opt_code, value) {
                        return err_out(&msg, 1);
                    }
                    break;
                }
                _ => return err_out(&format!("column: unsupported option: -{ch}\n"), 1),
            }
            offset += 1;
        }
        index += 1;
    }

    if opts.help {
        return ok_out("Usage: column [-t] [-s characters] [-o string] [-c width] [-x] [file ...]\n");
    }
    if opts.table && opts.across {
        return err_out("column: -x/--fillrows cannot be combined with table mode\n", 1);
    }
    if !opts.definitions.is_empty() && !opts.names.is_empty() {
        return err_out(
            "column: --table-columns and --table-column are mutually exclusive\n",
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
        return err_out("column: table options require -t/--table\n", 1);
    }
    if opts.json
        && (opts.names.is_empty()
            || (!opts.definitions.is_empty()
                && !opts
                    .definitions
                    .iter()
                    .any(|d| d.named && !d.name.is_empty())))
    {
        return err_out("column: JSON output requires --table-columns\n", 1);
    }
    if !opts.table && (opts.separator.is_some() || output_set) {
        return err_out("column: input/output separators require -t/--table\n", 1);
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

    for file in &opts.files {
        let content = if file == "-" {
            stdin.to_string()
        } else {
            let p = resolve_posix_path(cwd, file);
            if fs.is_dir(&p) {
                stderr.push_str(&format!("column: {file}: Is a directory\n"));
                exit_code = 1;
                continue;
            }
            match fs.read_file(&p) {
                Ok(b) => crate::vfs::bytes_to_stream_string(&b),
                Err(_) => {
                    stderr.push_str(&format!("column: {file}: No such file or directory\n"));
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
                                "column: line {}: for JSON the name of the column {} is required\n",
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

fn cmd_shuf(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut head_count: Option<usize> = None;
    let mut echo_mode = false;
    let mut repeat = false;
    let mut zero_terminated = false;
    let mut range: Option<(usize, usize)> = None;
    let mut out_file: Option<String> = None;
    let mut items = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if (a == "-n" || a == "--head-count") && i + 1 < args.len() {
            head_count = args[i + 1].parse().ok();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--head-count=").or_else(|| a.strip_prefix("-n"))
            && !rest.is_empty()
        {
            head_count = rest.parse().ok();
            i += 1;
        } else if a == "-e" || a == "--echo" {
            echo_mode = true;
            i += 1;
        } else if a == "-r" || a == "--repeat" {
            repeat = true;
            i += 1;
        } else if a == "-z" || a == "--zero-terminated" {
            zero_terminated = true;
            i += 1;
        } else if (a == "-i" || a == "--input-range") && i + 1 < args.len() {
            if let Some((lo, hi)) = args[i + 1].split_once('-') {
                range = Some((lo.parse().unwrap_or(0), hi.parse().unwrap_or(0)));
            }
            i += 2;
        } else if let Some(rest) = a
            .strip_prefix("--input-range=")
            .or_else(|| a.strip_prefix("-i"))
            && !rest.is_empty()
        {
            if let Some((lo, hi)) = rest.split_once('-') {
                range = Some((lo.parse().unwrap_or(0), hi.parse().unwrap_or(0)));
            }
            i += 1;
        } else if (a == "-o" || a == "--output") && i + 1 < args.len() {
            out_file = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--output=") {
            out_file = Some(rest.to_string());
            i += 1;
        } else if a == "--random-source" && i + 1 < args.len() {
            i += 2;
        } else if a.starts_with("--random-source=") {
            i += 1;
        } else if !a.starts_with('-') || echo_mode {
            items.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let mut lines: Vec<String> = if let Some((lo, hi)) = range {
        (lo..=hi).map(|n| n.to_string()).collect()
    } else if echo_mode {
        items
    } else {
        let text = match read_inputs_or_stdin(&items, stdin, cwd, fs, "shuf") {
            Ok(t) => t,
            Err(e) => return e,
        };
        if zero_terminated {
            let mut v: Vec<String> = text.split('\0').map(|s| s.to_string()).collect();
            if v.last().is_some_and(|s| s.is_empty()) {
                v.pop();
            }
            v
        } else {
            text.lines().map(|s| s.to_string()).collect()
        }
    };
    if let Some(n) = head_count {
        if repeat && !lines.is_empty() {
            let base = lines.clone();
            lines.clear();
            for idx in 0..n {
                lines.push(base[idx % base.len()].clone());
            }
        } else {
            lines.truncate(n);
        }
    }
    let term = if zero_terminated { "\0" } else { "\n" };
    let rendered = if lines.is_empty() {
        String::new()
    } else {
        format!("{}{term}", lines.join(term))
    };
    if let Some(of) = out_file {
        let p = resolve_posix_path(cwd, &of);
        let _ = fs.write_file(&p, rendered.as_bytes());
        ok_out("")
    } else {
        ok_out(&rendered)
    }
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
        .get("__limit_split_max_files")
        .and_then(|v| v.parse::<usize>().ok());
    let parsed = match parse_split_args(args, max_files) {
        Ok(p) => p,
        Err(msg) => return err_out(&msg, 1),
    };
    let input_files = vec![parsed.input.clone()];
    let text = match read_inputs_or_stdin(&input_files, stdin, cwd, fs, "split") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let raw_bytes = stream_string_to_bytes(&text);

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
        if fs.is_dir(&out_path) {
            return err_out(&format!("split: {file_name}: Is a directory\n"), 1);
        }
        if let Err(e) = fs.write_file(&out_path, &chunk) {
            return err_out(&format!("split: {file_name}: {e}\n"), 1);
        }
        if parsed.verbose {
            stdout.push_str(&format!("creating file '{file_name}'\n"));
        }
    }
    let _ = (BTreeSet::<u8>::new(), normalize_posix_path);
    ok_out(&stdout)
}

fn cmd_dd(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut in_file: Option<String> = None;
    let mut out_file: Option<String> = None;
    let mut bs = 512usize;
    let mut ibs: Option<usize> = None;
    let mut cbs = 8usize;
    let mut skip = 0usize;
    let mut seek = 0usize;
    let mut count: Option<usize> = None;
    let mut lcase = false;
    let mut ucase = false;
    let mut notrunc = false;
    let mut swab = false;
    let mut sync_pad = false;
    let mut block_conv = false;
    let mut unblock_conv = false;
    let mut ebcdic_conv = false;
    let mut ascii_conv = false;
    for a in args {
        if let Some(v) = a.strip_prefix("if=") {
            in_file = Some(v.to_string());
        } else if let Some(v) = a.strip_prefix("of=") {
            out_file = Some(v.to_string());
        } else if let Some(v) = a.strip_prefix("bs=") {
            bs = v.parse().unwrap_or(512).max(1);
        } else if let Some(v) = a.strip_prefix("ibs=") {
            ibs = v.parse::<usize>().ok().map(|n| n.max(1));
        } else if let Some(v) = a.strip_prefix("cbs=") {
            cbs = v.parse().unwrap_or(8).max(1);
        } else if let Some(v) = a.strip_prefix("skip=") {
            skip = v.parse().unwrap_or(0);
        } else if let Some(v) = a.strip_prefix("seek=") {
            seek = v.parse().unwrap_or(0);
        } else if let Some(v) = a.strip_prefix("count=") {
            count = v.parse().ok();
        } else if let Some(v) = a.strip_prefix("conv=") {
            if v.contains("lcase") {
                lcase = true;
            }
            if v.contains("ucase") {
                ucase = true;
            }
            if v.contains("notrunc") {
                notrunc = true;
            }
            if v.contains("swab") {
                swab = true;
            }
            if v.contains("sync") {
                sync_pad = true;
            }
            if v.contains("unblock") {
                unblock_conv = true;
            } else if v.contains("block") {
                block_conv = true;
            }
            if v.contains("ebcdic") {
                ebcdic_conv = true;
            }
            if v.contains("ascii") {
                ascii_conv = true;
            }
        }
    }
    let in_bs = ibs.unwrap_or(bs);
    let data = if let Some(inf) = in_file {
        let full = resolve_posix_path(cwd, &inf);
        fs.read_file(&full).unwrap_or_default()
    } else {
        stream_string_to_bytes(stdin)
    };
    let start = (skip * in_bs).min(data.len());
    let end = match count {
        Some(c) => (start + c * in_bs).min(data.len()),
        None => data.len(),
    };
    let mut slice = data[start..end].to_vec();
    if block_conv {
        let mut out_b = Vec::new();
        for line in slice.split(|&b| b == b'\n') {
            if line.is_empty() && slice.ends_with(b"\n") {
                continue;
            }
            for i in 0..cbs {
                out_b.push(*line.get(i).unwrap_or(&b' '));
            }
        }
        slice = out_b;
    } else if unblock_conv {
        let mut out_b = Vec::new();
        for rec in slice.chunks(cbs) {
            let trimmed_len = rec
                .iter()
                .rposition(|&b| b != b' ')
                .map(|p| p + 1)
                .unwrap_or(0);
            out_b.extend_from_slice(&rec[..trimmed_len]);
            out_b.push(b'\n');
        }
        slice = out_b;
    }
    if ebcdic_conv || ascii_conv {
        for b in &mut slice {
            *b ^= 0x80;
        }
    }
    if lcase {
        for b in &mut slice {
            *b = b.to_ascii_lowercase();
        }
    }
    if ucase {
        for b in &mut slice {
            *b = b.to_ascii_uppercase();
        }
    }
    if swab {
        for pair in slice.chunks_exact_mut(2) {
            pair.swap(0, 1);
        }
    }
    if sync_pad && !slice.is_empty() && (slice.len() % in_bs) != 0 {
        let rem = in_bs - (slice.len() % in_bs);
        slice.resize(slice.len() + rem, 0);
    }
    if let Some(outf) = out_file {
        let full = resolve_posix_path(cwd, &outf);
        let seek_bytes = seek * bs;
        if seek_bytes > 0 || notrunc {
            let mut dest = fs.read_file(&full).unwrap_or_default();
            if dest.len() < seek_bytes + slice.len() {
                dest.resize(seek_bytes + slice.len(), 0);
            }
            dest[seek_bytes..seek_bytes + slice.len()].copy_from_slice(&slice);
            if !notrunc {
                dest.truncate(seek_bytes + slice.len());
            }
            let _ = fs.write_file(&full, &dest);
        } else {
            let _ = fs.write_file(&full, &slice);
        }
        ok_out("")
    } else {
        ok_out(&crate::vfs::bytes_to_stream_string(&slice))
    }
}

fn cmd_install(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut create_dirs = false;
    let mut dir_mode = false;
    let mut backup_mode: Option<&str> = None;
    let mut suffix = "~".to_string();
    let mut compare_mode = false;
    let mut preserve_ts = false;
    let mut strip_mode = false;
    let mut no_target_dir = false;
    let mut target_dir: Option<String> = None;
    let mut mode_spec: Option<String> = None;
    let mut ended = false;
    let mut files = Vec::new();
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
        match a.as_str() {
            "--help" => return ok_out("Usage: install [OPTION]... SOURCE... DEST\n"),
            "--version" => return ok_out("install (Sandbox VFS-ish/GNU coreutils) 9.7\n"),
            "--compare" => compare_mode = true,
            "--directory" => dir_mode = true,
            "--preserve-timestamps" => preserve_ts = true,
            "--strip" => strip_mode = true,
            "--no-target-directory" => no_target_dir = true,
            "--verbose" => {}
            "--backup" => backup_mode = Some("existing"),
            s if s.starts_with("--backup=") => {
                let ctl = &s["--backup=".len()..];
                backup_mode = match ctl {
                    "none" | "off" => None,
                    "numbered" | "t" => Some("numbered"),
                    "existing" | "nil" => Some("existing"),
                    "simple" | "never" => Some("simple"),
                    _ => return err_out(&format!("install: invalid backup type '{ctl}'\n"), 1),
                };
            }
            "--mode" => {
                if i + 1 >= args.len() {
                    return err_out("install: option '--mode' requires an argument\n", 1);
                }
                i += 1;
                mode_spec = Some(args[i].clone());
            }
            s if s.starts_with("--mode=") => {
                mode_spec = Some(s["--mode=".len()..].to_string());
            }
            "--target-directory" => {
                if i + 1 >= args.len() {
                    return err_out(
                        "install: option '--target-directory' requires an argument\n",
                        1,
                    );
                }
                i += 1;
                target_dir = Some(args[i].clone());
            }
            s if s.starts_with("--target-directory=") => {
                target_dir = Some(s["--target-directory=".len()..].to_string());
            }
            "--suffix" => {
                if i + 1 >= args.len() {
                    return err_out("install: option '--suffix' requires an argument\n", 1);
                }
                i += 1;
                suffix = args[i].clone();
                if backup_mode.is_none() {
                    backup_mode = Some("existing");
                }
            }
            s if s.starts_with("--suffix=") => {
                suffix = s["--suffix=".len()..].to_string();
                if backup_mode.is_none() {
                    backup_mode = Some("existing");
                }
            }
            s if !s.starts_with("--") => {
                let chars: Vec<char> = s[1..].chars().collect();
                let mut j = 0usize;
                while j < chars.len() {
                    match chars[j] {
                        'D' => create_dirs = true,
                        'C' => compare_mode = true,
                        'd' => dir_mode = true,
                        'b' => {
                            if backup_mode.is_none() {
                                backup_mode = Some("existing");
                            }
                        }
                        'p' => preserve_ts = true,
                        's' => strip_mode = true,
                        'T' => no_target_dir = true,
                        'c' | 'v' => {}
                        'm' => {
                            let rest: String = chars[j + 1..].iter().collect();
                            if !rest.is_empty() {
                                mode_spec = Some(rest);
                            } else if i + 1 < args.len() {
                                i += 1;
                                mode_spec = Some(args[i].clone());
                            } else {
                                return err_out("install: option requires an argument -- 'm'\n", 1);
                            }
                            break;
                        }
                        't' => {
                            let rest: String = chars[j + 1..].iter().collect();
                            if !rest.is_empty() {
                                target_dir = Some(rest);
                            } else if i + 1 < args.len() {
                                i += 1;
                                target_dir = Some(args[i].clone());
                            } else {
                                return err_out("install: option requires an argument -- 't'\n", 1);
                            }
                            break;
                        }
                        'S' => {
                            let rest: String = chars[j + 1..].iter().collect();
                            if !rest.is_empty() {
                                suffix = rest;
                            } else if i + 1 < args.len() {
                                i += 1;
                                suffix = args[i].clone();
                            } else {
                                return err_out("install: option requires an argument -- 'S'\n", 1);
                            }
                            if backup_mode.is_none() {
                                backup_mode = Some("existing");
                            }
                            break;
                        }
                        ch => {
                            return err_out(&format!("install: invalid option -- '{ch}'\n"), 1);
                        }
                    }
                    j += 1;
                }
            }
            _ => return err_out(&format!("install: unrecognized option '{a}'\n"), 1),
        }
        i += 1;
    }

    if compare_mode && preserve_ts {
        return err_out(
            "install: options --compare (-C) and --preserve-timestamps are mutually exclusive\n",
            1,
        );
    }
    if compare_mode && strip_mode {
        return err_out(
            "install: options --compare (-C) and --strip are mutually exclusive\n",
            1,
        );
    }
    if no_target_dir && target_dir.is_some() {
        return err_out(
            "install: cannot combine --target-directory (-t) and --no-target-directory (-T)\n",
            1,
        );
    }

    if dir_mode {
        if files.is_empty() {
            return err_out("install: missing file operand\n", 1);
        }
        let target_mode = mode_spec
            .as_deref()
            .map(|spec| crate::commands::fs::eval_chmod_mode(spec, 0, true))
            .unwrap_or(0o755);
        for f in &files {
            let d = resolve_posix_path(cwd, f);
            let _ = fs.mkdir_all(&d);
            let _ = fs.chmod(&d, 0o040000 | target_mode);
        }
        return ok_out("");
    }

    let target_mode = mode_spec
        .as_deref()
        .map(|spec| crate::commands::fs::eval_chmod_mode(spec, 0, false))
        .unwrap_or(0o755);

    let (sources, target_dir_opt, single_dest_opt): (Vec<String>, Option<String>, Option<String>) =
        if let Some(td) = target_dir {
            if files.is_empty() {
                return err_out("install: missing file operand\n", 1);
            }
            (files, Some(td), None)
        } else {
            if files.len() < 2 {
                return err_out("install: missing destination file operand\n", 1);
            }
            let last = files.last().unwrap().clone();
            let last_resolved = resolve_posix_path(cwd, &last);
            if !no_target_dir && fs.is_dir(&last_resolved) {
                (files[..files.len() - 1].to_vec(), Some(last), None)
            } else if files.len() > 2 {
                return err_out(&format!("install: target '{last}' is not a directory\n"), 1);
            } else {
                (vec![files[0].clone()], None, Some(last))
            }
        };

    if let Some(ref td) = target_dir_opt {
        let td_resolved = resolve_posix_path(cwd, td);
        if create_dirs {
            let _ = fs.mkdir_all(&td_resolved);
        }
        if !fs.is_dir(&td_resolved) {
            return err_out(
                &format!("install: failed to access '{td}': No such file or directory\n"),
                1,
            );
        }
    }

    let mut err_buf = String::new();
    let mut exit_code = 0;

    for src_arg in &sources {
        let src = resolve_posix_path(cwd, src_arg);
        if !fs.exists(&src) {
            err_buf.push_str(&format!(
                "install: cannot stat '{src_arg}': No such file or directory\n"
            ));
            exit_code = 1;
            continue;
        }
        if fs.is_dir(&src) {
            err_buf.push_str(&format!("install: omitting directory '{src_arg}'\n"));
            exit_code = 1;
            continue;
        }
        let dst = if let Some(ref td) = target_dir_opt {
            let base = crate::vfs::basename_posix_path(&src);
            resolve_posix_path(cwd, &format!("{}/{base}", td.trim_end_matches('/')))
        } else {
            let d = resolve_posix_path(cwd, single_dest_opt.as_ref().unwrap());
            if create_dirs {
                let parent = dirname_posix_path(&d);
                let _ = fs.mkdir_all(&parent);
            }
            d
        };
        if fs.is_dir(&dst) {
            err_buf.push_str(&format!(
                "install: cannot overwrite directory '{dst}' with non-directory '{src_arg}'\n"
            ));
            exit_code = 1;
            continue;
        }
        let Ok(src_bytes) = fs.read_file(&src) else {
            err_buf.push_str(&format!("install: cannot open '{src_arg}' for reading\n"));
            exit_code = 1;
            continue;
        };
        if compare_mode
            && let (Ok(dst_bytes), Ok(dst_st)) = (fs.read_file(&dst), fs.stat(&dst))
            && src_bytes == dst_bytes
            && (dst_st.mode & 0o7777) == (target_mode & 0o7777)
        {
            continue;
        }
        if let Some(bmode) = backup_mode
            && let Ok(old_bytes) = fs.read_file(&dst)
        {
            let mut highest_numbered = 0usize;
            for k in 1..1000usize {
                if fs.exists(&format!("{dst}.~{k}~")) {
                    highest_numbered = k;
                }
            }
            let use_numbered = bmode == "numbered" || (bmode == "existing" && highest_numbered > 0);
            if use_numbered {
                let next_k = highest_numbered + 1;
                let _ = fs.write_file(&format!("{dst}.~{next_k}~"), &old_bytes);
            } else {
                let _ = fs.write_file(&format!("{dst}{suffix}"), &old_bytes);
            }
        }
        let parent = dirname_posix_path(&dst);
        if !fs.is_dir(&parent) {
            err_buf.push_str(&format!(
                "install: cannot create regular file '{dst}': No such file or directory\n"
            ));
            exit_code = 1;
            continue;
        }
        if fs.write_file(&dst, &src_bytes).is_ok() {
            let _ = fs.chmod(&dst, 0o100000 | target_mode);
            if preserve_ts && let Ok(st) = fs.stat(&src) {
                let _ = fs.set_mtime(&dst, st.mtime_ms);
            }
        } else {
            err_buf.push_str(&format!("install: cannot create regular file '{dst}'\n"));
            exit_code = 1;
        }
    }
    BuiltinOutcome {
        stdout: String::new(),
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

fn cmd_join(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
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
            return Err(format!("join: invalid {label}: '{val}'\n"));
        }
        let n = s
            .parse::<usize>()
            .map_err(|_| format!("join: invalid {label}: '{val}'\n"))?;
        if n < 1 {
            return Err(format!("join: invalid {label}: '{val}'\n"));
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
                "join: incompatible join fields {}, {}\n",
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
                    return Err(format!("join: invalid file number: '{value}'\n"));
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
                    return Err("join: conflicting empty-field replacement strings\n".to_string());
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
                    return Err("join: incompatible field delimiters\n".to_string());
                }
                delimiter_choice = Some(choice);
                if value == "\\0" {
                    delimiter = Some(0u8);
                    whole = false;
                } else if bytes.is_empty() {
                    whole = true;
                    delimiter = None;
                } else if bytes.len() != 1 {
                    return Err("join: multi-character tab\n".to_string());
                } else {
                    delimiter = Some(bytes[0]);
                    whole = false;
                }
            }
            'o' => {
                if value == "auto" {
                    if matches!(format, JoinFormat::Explicit(_)) {
                        return Err("join: conflicting output format specifications\n".to_string());
                    }
                    format = JoinFormat::Auto;
                } else {
                    if matches!(format, JoinFormat::Auto) {
                        return Err("join: conflicting output format specifications\n".to_string());
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
                            return Err(format!("join: invalid field specifier: '{part}'\n"));
                        }
                    }
                    if specs.is_empty() {
                        return Err(format!("join: invalid field specifier: '{value}'\n"));
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
                    return err_out("join: extra operand\n", 1);
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
                _ => return err_out(&format!("join: unrecognized option '{token}'\n"), 1),
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
                            &format!("join: option requires an argument -- '{flag}'\n"),
                            1,
                        );
                    };
                    if let Err(msg) = apply_flag(flag, &val, &mut explicit_fields, &mut fields) {
                        return err_out(&msg, 1);
                    }
                    break;
                }
                _ => return err_out(&format!("join: invalid option -- '{flag}'\n"), 1),
            }
        }
        index += 1;
    }

    if files.len() != 2 {
        return err_out("join: missing operand\n", 1);
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
        return err_out("join: both files cannot be standard input\n", 1);
    }

    let read_file_records = |name: &str| -> Result<Vec<Vec<u8>>, String> {
        let raw = if name == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let path = resolve_posix_path(cwd, name);
            if fs.is_dir(&path) {
                return Err(format!("join: {name}: Is a directory\n"));
            }
            fs.read_file(&path)
                .map_err(|e| format!("join: {name}: {e}\n"))?
        };
        if raw.is_empty() {
            return Ok(Vec::new());
        }
        let mut recs: Vec<Vec<u8>> = Vec::new();
        let mut start = 0usize;
        for (idx, &b) in raw.iter().enumerate() {
            if b == separator {
                recs.push(raw[start..idx].to_vec());
                start = idx + 1;
            }
        }
        if start < raw.len() {
            recs.push(raw[start..].to_vec());
        }
        Ok(recs)
    };

    let raw_rows0 = match read_file_records(&files[0]) {
        Ok(r) => r,
        Err(msg) => return err_out(&msg, 1),
    };
    let raw_rows1 = match read_file_records(&files[1]) {
        Ok(r) => r,
        Err(msg) => return err_out(&msg, 1),
    };
    let raw_sources = [raw_rows0, raw_rows1];

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

    let mut cursors = [0usize, 0usize];
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
     -> Result<(), ()> {
        let msg = format!("join: file {} is not in sorted order\n", file_idx + 1);
        if order_mode == OrderMode::Check {
            stderr.push_str(&msg);
            *order_failed = true;
            return Err(());
        }
        if !order_warned[file_idx] {
            order_warned[file_idx] = true;
            *order_failed = true;
            stderr.push_str(&msg);
        }
        Ok(())
    };

    let mark_unpaired = |order_unpaired: &mut bool,
                             order_pending: &mut [bool; 2],
                             order_warned: &mut [bool; 2],
                             order_failed: &mut bool,
                             stderr: &mut String|
     -> Result<(), ()> {
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

    let next_row = |file_idx: usize,
                        reset: bool,
                        cursors: &mut [usize; 2],
                        prev_keys: &mut [Option<Vec<u8>>; 2],
                        order_unpaired: &bool,
                        order_pending: &mut [bool; 2],
                        order_warned: &mut [bool; 2],
                        order_failed: &mut bool,
                        stderr: &mut String|
     -> Result<Option<JoinRow>, ()> {
        let c = cursors[file_idx];
        if c >= raw_sources[file_idx].len() {
            return Ok(None);
        }
        cursors[file_idx] += 1;
        let row = split_row(&raw_sources[file_idx][c], file_idx);
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

    let r0 = match next_row(
        0,
        false,
        &mut cursors,
        &mut prev_keys,
        &order_unpaired,
        &mut order_pending,
        &mut order_warned,
        &mut order_failed,
        &mut stderr,
    ) {
        Ok(v) => v,
        Err(()) => {
            return BuiltinOutcome {
                stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                stderr,
                exit_code: 1,
            };
        }
    };
    let r1 = match next_row(
        1,
        false,
        &mut cursors,
        &mut prev_keys,
        &order_unpaired,
        &mut order_pending,
        &mut order_warned,
        &mut order_failed,
        &mut stderr,
    ) {
        Ok(v) => v,
        Err(()) => {
            return BuiltinOutcome {
                stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                stderr,
                exit_code: 1,
            };
        }
    };

    let mut rows: [Option<JoinRow>; 2] = [r0, r1];
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
        for (idx, field_bytes) in selected_fields.iter().enumerate() {
            if idx > 0 {
                out.push(out_delim);
            }
            if field_bytes.is_empty() {
                out.extend_from_slice(&replacement);
            } else {
                out.extend_from_slice(field_bytes);
            }
        }
        out.push(separator);
    };

    if header && (rows[0].is_some() || rows[1].is_some()) {
        emit_row(&mut out_bytes, rows[0].as_ref(), rows[1].as_ref());
        for f_idx in 0..2 {
            if rows[f_idx].is_some() {
                match next_row(
                    f_idx,
                    true,
                    &mut cursors,
                    &mut prev_keys,
                    &order_unpaired,
                    &mut order_pending,
                    &mut order_warned,
                    &mut order_failed,
                    &mut stderr,
                ) {
                    Ok(v) => rows[f_idx] = v,
                    Err(()) => {
                        return BuiltinOutcome {
                            stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                            stderr,
                            exit_code: 1,
                        };
                    }
                }
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
            if mark_unpaired(
                &mut order_unpaired,
                &mut order_pending,
                &mut order_warned,
                &mut order_failed,
                &mut stderr,
            )
            .is_err()
            {
                return BuiltinOutcome {
                    stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                    stderr,
                    exit_code: 1,
                };
            }
            let file_idx = if cmp == std::cmp::Ordering::Less { 0 } else { 1 };
            if unpaired[file_idx] {
                emit_row(
                    &mut out_bytes,
                    if file_idx == 0 { rows[0].as_ref() } else { None },
                    if file_idx == 1 { rows[1].as_ref() } else { None },
                );
            }
            match next_row(
                file_idx,
                false,
                &mut cursors,
                &mut prev_keys,
                &order_unpaired,
                &mut order_pending,
                &mut order_warned,
                &mut order_failed,
                &mut stderr,
            ) {
                Ok(v) => rows[file_idx] = v,
                Err(()) => {
                    return BuiltinOutcome {
                        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                        stderr,
                        exit_code: 1,
                    };
                }
            }
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
                match next_row(
                    file_idx,
                    false,
                    &mut cursors,
                    &mut prev_keys,
                    &order_unpaired,
                    &mut order_pending,
                    &mut order_warned,
                    &mut order_failed,
                    &mut stderr,
                ) {
                    Ok(v) => rows[file_idx] = v,
                    Err(()) => {
                        return BuiltinOutcome {
                            stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                            stderr,
                            exit_code: 1,
                        };
                    }
                }
            }
        }
        if paired {
            for left in &groups[0] {
                for right in &groups[1] {
                    emit_row(&mut out_bytes, Some(left), Some(right));
                }
            }
        }
    }

    for file_idx in 0..2 {
        if !unpaired[file_idx] && order_mode == OrderMode::None {
            continue;
        }
        if rows[file_idx].is_some()
            && mark_unpaired(
                &mut order_unpaired,
                &mut order_pending,
                &mut order_warned,
                &mut order_failed,
                &mut stderr,
            )
            .is_err()
        {
            return BuiltinOutcome {
                stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                stderr,
                exit_code: 1,
            };
        }
        while let Some(ref cur) = rows[file_idx] {
            if unpaired[file_idx] {
                emit_row(
                    &mut out_bytes,
                    if file_idx == 0 { Some(cur) } else { None },
                    if file_idx == 1 { Some(cur) } else { None },
                );
            }
            match next_row(
                file_idx,
                false,
                &mut cursors,
                &mut prev_keys,
                &order_unpaired,
                &mut order_pending,
                &mut order_warned,
                &mut order_failed,
                &mut stderr,
            ) {
                Ok(v) => rows[file_idx] = v,
                Err(()) => {
                    return BuiltinOutcome {
                        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                        stderr,
                        exit_code: 1,
                    };
                }
            }
        }
    }

    if order_failed {
        stderr.push_str("join: input is not in sorted order\n");
    }

    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        stderr,
        exit_code: if order_failed { 1 } else { 0 },
    }
}

fn cmd_getopt(args: &[String]) -> BuiltinOutcome {
    let mut short_spec = String::new();
    let mut long_specs: Vec<String> = Vec::new();
    let mut i = 0usize;
    let mut has_o = false;

    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            i += 1;
            break;
        } else if (a == "-o" || a == "--options") && i + 1 < args.len() {
            short_spec = args[i + 1].clone();
            has_o = true;
            i += 2;
        } else if (a == "-l" || a == "--long" || a == "--longoptions") && i + 1 < args.len() {
            for part in args[i + 1].split(',').filter(|s| !s.is_empty()) {
                long_specs.push(part.to_string());
            }
            i += 2;
        } else if (a == "-n" || a == "--name") && i + 1 < args.len() {
            i += 2;
        } else if a == "-q" || a == "-u" {
            i += 1;
        } else if !has_o && !a.starts_with('-') {
            short_spec = a.clone();
            i += 1;
            break;
        } else {
            break;
        }
    }

    let mut short_map: BTreeMap<char, u8> = BTreeMap::new();
    let s_chars: Vec<char> = short_spec.chars().collect();
    let mut si = 0usize;
    while si < s_chars.len() {
        let c = s_chars[si];
        if c == ':' {
            si += 1;
            continue;
        }
        if si + 2 < s_chars.len() && s_chars[si + 1] == ':' && s_chars[si + 2] == ':' {
            short_map.insert(c, 2);
            si += 3;
        } else if si + 1 < s_chars.len() && s_chars[si + 1] == ':' {
            short_map.insert(c, 1);
            si += 2;
        } else {
            short_map.insert(c, 0);
            si += 1;
        }
    }

    let mut long_map: BTreeMap<String, u8> = BTreeMap::new();
    for ls in &long_specs {
        if let Some(name) = ls.strip_suffix("::") {
            long_map.insert(name.to_string(), 2);
        } else if let Some(name) = ls.strip_suffix(':') {
            long_map.insert(name.to_string(), 1);
        } else {
            long_map.insert(ls.clone(), 0);
        }
    }

    let quote_sq = |s: &str| -> String { format!("'{}'", s.replace('\'', "'\\''")) };
    let mut opts_out: Vec<String> = Vec::new();
    let mut pos_out: Vec<String> = Vec::new();
    let target_args = &args[i..];
    let mut ti = 0usize;

    while ti < target_args.len() {
        let arg = &target_args[ti];
        if arg == "--" {
            for p in &target_args[ti + 1..] {
                pos_out.push(quote_sq(p));
            }
            break;
        } else if let Some(long_rest) = arg.strip_prefix("--") {
            if let Some((lname, lval)) = long_rest.split_once('=') {
                opts_out.push(format!("--{lname}"));
                opts_out.push(quote_sq(lval));
            } else {
                let mode = long_map.get(long_rest).copied().unwrap_or(0);
                opts_out.push(format!("--{long_rest}"));
                if mode == 1 {
                    if let Some(next_val) = target_args.get(ti + 1) {
                        opts_out.push(quote_sq(next_val));
                        ti += 1;
                    }
                } else if mode == 2 {
                    opts_out.push("''".to_string());
                }
            }
            ti += 1;
        } else if arg.starts_with('-') && arg.len() > 1 {
            let chars: Vec<char> = arg[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                let ch = chars[ci];
                let mode = short_map.get(&ch).copied().unwrap_or(0);
                opts_out.push(format!("-{ch}"));
                if mode == 1 {
                    if ci + 1 < chars.len() {
                        let rest: String = chars[ci + 1..].iter().collect();
                        opts_out.push(quote_sq(&rest));
                        break;
                    } else if let Some(next_val) = target_args.get(ti + 1) {
                        opts_out.push(quote_sq(next_val));
                        ti += 1;
                    }
                    break;
                } else if mode == 2 {
                    if ci + 1 < chars.len() {
                        let rest: String = chars[ci + 1..].iter().collect();
                        opts_out.push(quote_sq(&rest));
                    } else {
                        opts_out.push("''".to_string());
                    }
                    break;
                }
                ci += 1;
            }
            ti += 1;
        } else {
            pos_out.push(quote_sq(arg));
            ti += 1;
        }
    }

    let mut all = opts_out;
    all.push("--".to_string());
    all.extend(pos_out);
    ok_out(&format!(" {}\n", all.join(" ")))
}

fn cmd_dos2unix(
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    to_dos: bool,
) -> BuiltinOutcome {
    let mut keep_bom = to_dos;
    let mut add_bom = false;
    let mut force = false;
    let mut add_eol = false;
    let mut double_nl = false;
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
            info_flags = Some(rest.to_string());
            i += 1;
        } else if let Some(rest) = a.strip_prefix("-i") && !rest.is_empty() {
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
                    'e' => add_eol = true,
                    'l' => double_nl = true,
                    'n' => newfile_mode = true,
                    'o' => {
                        newfile_mode = false;
                        to_stdout = false;
                    }
                    'O' => {
                        newfile_mode = false;
                        to_stdout = true;
                    }
                    _ => {}
                }
            }
            i += 1;
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
                f.rsplit('/').next().unwrap_or(f)
            } else {
                f.as_str()
            };
            let sep = if fields.is_empty() { "" } else { "  " };
            let term = if flags_str.contains('0') { "\0" } else { "\n" };
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
        let mut idx = 0usize;
        while idx < body.len() {
            let b = body[idx];
            if b == b'\r' && body.get(idx + 1) == Some(&b'\n') {
                let count = if double_nl { 2 } else { 1 };
                for _ in 0..count {
                    if to_dos {
                        out.extend_from_slice(b"\r\n");
                    } else {
                        out.push(b'\n');
                    }
                }
                idx += 2;
            } else if b == b'\n' {
                let count = if double_nl { 2 } else { 1 };
                for _ in 0..count {
                    if to_dos {
                        out.extend_from_slice(b"\r\n");
                    } else {
                        out.push(b'\n');
                    }
                }
                idx += 1;
            } else {
                out.push(b);
                idx += 1;
            }
        }
        if add_eol && !body.is_empty() && !body.ends_with(b"\n") {
            if to_dos {
                out.extend_from_slice(b"\r\n");
            } else {
                out.push(b'\n');
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
        for pair in files.chunks(2) {
            if pair.len() == 2 {
                let in_p = resolve_posix_path(cwd, &pair[0]);
                let out_p = resolve_posix_path(cwd, &pair[1]);
                if let Ok(bytes) = fs.read_file(&in_p)
                    && let Some(conv) = convert_bytes(&bytes)
                {
                    let _ = fs.write_file(&out_p, &conv);
                }
            }
        }
        return ok_out("");
    }
    for f in &files {
        let p = resolve_posix_path(cwd, f);
        if let Ok(bytes) = fs.read_file(&p)
            && let Some(conv) = convert_bytes(&bytes)
        {
            let _ = fs.write_file(&p, &conv);
        }
    }
    ok_out("")
}

fn normalize_encoding_name(enc: &str) -> String {
    let base = enc.split("//").next().unwrap_or(enc);
    base.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

fn cmd_iconv(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut from_enc = "UTF-8".to_string();
    let mut to_enc = "UTF-8".to_string();
    let mut discard = false;
    let mut out_file: Option<String> = None;
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-c" || a == "-sc" || a == "-cs" {
            discard = true;
            i += 1;
        } else if a == "-s" || a == "--silent" {
            i += 1;
        } else if (a == "-f" || a == "--from-code") && i + 1 < args.len() {
            from_enc = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--from-code=").or_else(|| a.strip_prefix("-f")) && !rest.is_empty() {
            from_enc = rest.to_string();
            i += 1;
        } else if (a == "-t" || a == "--to-code") && i + 1 < args.len() {
            to_enc = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--to-code=").or_else(|| a.strip_prefix("-t")) && !rest.is_empty() {
            to_enc = rest.to_string();
            i += 1;
        } else if (a == "-o" || a == "--output") && i + 1 < args.len() {
            out_file = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--output=").or_else(|| a.strip_prefix("-o")) && !rest.is_empty() {
            out_file = Some(rest.to_string());
            i += 1;
        } else if !a.starts_with('-') || a == "-" {
            files.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    if to_enc.to_uppercase().contains("//IGNORE") {
        discard = true;
    }

    let mut raw_in = Vec::new();
    if files.is_empty() || (files.len() == 1 && files[0] == "-") {
        raw_in = stream_string_to_bytes(stdin);
    } else {
        for f in &files {
            if f == "-" {
                raw_in.extend_from_slice(&stream_string_to_bytes(stdin));
            } else {
                let p = resolve_posix_path(cwd, f);
                match fs.read_file(&p) {
                    Ok(b) => raw_in.extend_from_slice(&b),
                    Err(_) => return err_out(&format!("iconv: cannot open input file `{f}'\n"), 1),
                }
            }
        }
    }

    let from_norm = normalize_encoding_name(&from_enc);
    let to_norm = normalize_encoding_name(&to_enc);
    let mut discarded = false;
    let mut codepoints: Vec<u32> = Vec::new();

    match from_norm.as_str() {
        "ISO88591" | "LATIN1" => {
            for &b in &raw_in {
                codepoints.push(u32::from(b));
            }
        }
        "ASCII" | "USASCII" => {
            for &b in &raw_in {
                if b < 128 {
                    codepoints.push(u32::from(b));
                } else if discard {
                    discarded = true;
                } else {
                    return err_out("iconv: illegal input sequence\n", 1);
                }
            }
        }
        "UTF16LE" | "UTF16BE" | "UTF16" => {
            let mut big = from_norm == "UTF16BE";
            let mut idx = 0usize;
            if from_norm == "UTF16" && raw_in.len() >= 2 {
                if raw_in[0] == 0xfe && raw_in[1] == 0xff {
                    big = true;
                    idx = 2;
                } else if raw_in[0] == 0xff && raw_in[1] == 0xfe {
                    big = false;
                    idx = 2;
                }
            }
            let mut u16s = Vec::new();
            while idx + 1 < raw_in.len() {
                let w = if big {
                    u16::from_be_bytes([raw_in[idx], raw_in[idx + 1]])
                } else {
                    u16::from_le_bytes([raw_in[idx], raw_in[idx + 1]])
                };
                u16s.push(w);
                idx += 2;
            }
            for res in char::decode_utf16(u16s) {
                match res {
                    Ok(c) => codepoints.push(c as u32),
                    Err(_) => {
                        if discard {
                            discarded = true;
                        } else {
                            return err_out("iconv: illegal input sequence\n", 1);
                        }
                    }
                }
            }
        }
        _ => {
            // UTF-8
            let mut idx = 0usize;
            while idx < raw_in.len() {
                let rest = &raw_in[idx..];
                match std::str::from_utf8(rest) {
                    Ok(valid) => {
                        for c in valid.chars() {
                            codepoints.push(c as u32);
                        }
                        break;
                    }
                    Err(e) => {
                        let valid_len = e.valid_up_to();
                        if valid_len > 0 {
                            if let Ok(valid) = std::str::from_utf8(&rest[..valid_len]) {
                                for c in valid.chars() {
                                    codepoints.push(c as u32);
                                }
                            }
                            idx += valid_len;
                        }
                        if discard {
                            discarded = true;
                            idx += e.error_len().unwrap_or(1).max(1);
                        } else {
                            return err_out("iconv: illegal input sequence\n", 1);
                        }
                    }
                }
            }
        }
    }

    let mut out_bytes: Vec<u8> = Vec::new();
    match to_norm.as_str() {
        "ISO88591" | "LATIN1" => {
            for cp in codepoints {
                if cp <= 0xff {
                    out_bytes.push(cp as u8);
                } else if discard {
                    discarded = true;
                } else {
                    return err_out("iconv: illegal input sequence\n", 1);
                }
            }
        }
        "ASCII" | "USASCII" => {
            for cp in codepoints {
                if cp <= 0x7f {
                    out_bytes.push(cp as u8);
                } else if discard {
                    discarded = true;
                } else {
                    return err_out("iconv: illegal input sequence\n", 1);
                }
            }
        }
        "UTF16LE" | "UTF16BE" => {
            let big = to_norm == "UTF16BE";
            let mut buf = [0u16; 2];
            for cp in codepoints {
                if let Some(ch) = char::from_u32(cp) {
                    for &w in ch.encode_utf16(&mut buf).iter() {
                        let b = if big { w.to_be_bytes() } else { w.to_le_bytes() };
                        out_bytes.extend_from_slice(&b);
                    }
                }
            }
        }
        _ => {
            let mut buf = [0u8; 4];
            for cp in codepoints {
                if let Some(ch) = char::from_u32(cp) {
                    out_bytes.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                }
            }
        }
    }

    let exit_code = if discarded { 1 } else { 0 };
    if let Some(of) = out_file {
        let p = resolve_posix_path(cwd, &of);
        let _ = fs.write_file(&p, &out_bytes);
        BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code,
        }
    } else {
        BuiltinOutcome {
            stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
            stderr: String::new(),
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
            return ok_out("Usage: tsort [OPTION] [FILE]\n");
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
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "tsort") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let raw_bytes = crate::vfs::stream_string_to_bytes(&text);
    let mut tokens: Vec<String> = Vec::new();
    let mut cur_tok: Vec<u8> = Vec::new();
    let mut in_tok = false;
    let mut had_nul = false;
    for &b in &raw_bytes {
        if b == b' ' || b == b'\t' || b == b'\n' {
            if in_tok {
                tokens.push(crate::vfs::bytes_to_stream_string(&cur_tok));
                cur_tok.clear();
                in_tok = false;
                had_nul = false;
            }
        } else {
            in_tok = true;
            if b == 0 {
                had_nul = true;
            }
            if !had_nul {
                cur_tok.push(b);
            }
        }
    }
    if in_tok {
        tokens.push(crate::vfs::bytes_to_stream_string(&cur_tok));
    }
    if !tokens.len().is_multiple_of(2) {
        return err_out(
            &format!("tsort: {reader_name}: input contains an odd number of tokens\n"),
            1,
        );
    }

    struct TsortNode {
        name: String,
        count: usize,
        printed: bool,
        edges: Vec<usize>,
    }

    let mut unique_names: BTreeSet<String> = BTreeSet::new();
    for t in &tokens {
        unique_names.insert(t.clone());
    }
    let mut ordered: Vec<TsortNode> = unique_names
        .into_iter()
        .map(|name| TsortNode {
            name,
            count: 0,
            printed: false,
            edges: Vec::new(),
        })
        .collect();
    let name_to_idx: BTreeMap<String, usize> = ordered
        .iter()
        .enumerate()
        .map(|(i, n)| (n.name.clone(), i))
        .collect();

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
            out.push_str(&ordered[u_idx].name);
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
                            stderr.push_str(&format!("tsort: {}\n", ordered[l_idx].name));
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

fn cmd_truncate(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut size_spec: Option<String> = None;
    let mut ref_file: Option<String> = None;
    let mut no_create = false;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            files.extend(args[i + 1..].iter().cloned());
            break;
        } else if (a == "-s" || a == "--size") && i + 1 < args.len() {
            size_spec = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(s) = a.strip_prefix("--size=") {
            size_spec = Some(s.to_string());
            i += 1;
        } else if let Some(s) = a.strip_prefix("-s") && !s.is_empty() {
            size_spec = Some(s.to_string());
            i += 1;
        } else if (a == "-r" || a == "--reference") && i + 1 < args.len() {
            ref_file = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(r) = a.strip_prefix("--reference=") {
            ref_file = Some(r.to_string());
            i += 1;
        } else if let Some(r) = a.strip_prefix("-r") && !r.is_empty() {
            ref_file = Some(r.to_string());
            i += 1;
        } else if a == "-c" || a == "--no-create" {
            no_create = true;
            i += 1;
        } else if a == "-o" || a == "--io-blocks" {
            i += 1;
        } else if !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
        } else {
            return err_out(&format!("truncate: invalid option '{a}'\n"), 1);
        }
    }
    if size_spec.is_none() && ref_file.is_none() {
        return err_out(
            "truncate: you must specify either '--size' or '--reference'\n",
            1,
        );
    }
    if files.is_empty() {
        return err_out("truncate: missing file operand\n", 1);
    }
    let ref_len = if let Some(rf) = &ref_file {
        let rp = resolve_posix_path(cwd, rf);
        match fs.stat(&rp) {
            Ok(st) => Some(st.size),
            Err(e) => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("truncate: cannot stat '{rf}': {e}\n"),
                    exit_code: 1,
                };
            }
        }
    } else {
        None
    };

    let mut op = '=';
    let mut delta = 0usize;
    let has_size = size_spec.is_some();
    if let Some(ref spec) = size_spec {
        let trimmed = spec.trim();
        let rest = if let Some(r) = trimmed.strip_prefix('+') {
            op = '+';
            r
        } else if let Some(r) = trimmed.strip_prefix('-') {
            op = '-';
            r
        } else if let Some(r) = trimmed.strip_prefix('<') {
            op = '<';
            r
        } else if let Some(r) = trimmed.strip_prefix('>') {
            op = '>';
            r
        } else if let Some(r) = trimmed.strip_prefix('/') {
            op = '/';
            r
        } else if let Some(r) = trimmed.strip_prefix('%') {
            op = '%';
            r
        } else {
            op = '=';
            trimmed
        };
        let rest = rest.trim_start();
        let num_len = rest.chars().take_while(|c| c.is_ascii_digit()).count();
        if num_len == 0 {
            return err_out(&format!("truncate: Invalid number: '{spec}'\n"), 1);
        }
        let Ok(base_num) = rest[..num_len].parse::<usize>() else {
            return err_out(&format!("truncate: Invalid number: '{spec}'\n"), 1);
        };
        let unit = rest[num_len..].trim().to_ascii_uppercase();
        let mult = match unit.as_str() {
            "" => 1usize,
            "K" | "KIB" => 1024usize,
            "KB" => 1000usize,
            "M" | "MIB" => 1024 * 1024,
            "MB" => 1_000_000usize,
            "G" | "GIB" => 1024 * 1024 * 1024,
            "GB" => 1_000_000_000usize,
            _ => {
                return err_out(&format!("truncate: Invalid number: '{spec}'\n"), 1);
            }
        };
        delta = base_num.saturating_mul(mult);
        if (op == '/' || op == '%') && delta == 0 {
            return err_out("truncate: division by zero\n", 1);
        }
    }

    for f in files {
        let full = resolve_posix_path(cwd, &f);
        if no_create && !fs.exists(&full) {
            continue;
        }
        let mut bytes = fs.read_file(&full).unwrap_or_default();
        let base = ref_len.unwrap_or(bytes.len());
        let target_len = if !has_size {
            base
        } else {
            match op {
                '+' => base.saturating_add(delta),
                '-' => base.saturating_sub(delta),
                '<' => base.min(delta),
                '>' => base.max(delta),
                '/' => (base / delta) * delta,
                '%' => base.div_ceil(delta) * delta,
                _ => delta,
            }
        };
        bytes.resize(target_len, 0u8);
        let _ = fs.write_file(&full, &bytes);
    }
    ok_out("")
}
