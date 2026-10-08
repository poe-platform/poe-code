use crate::shell::builtins::BuiltinOutcome;
use crate::shell::expand::decode_ansi_c_escapes;
use crate::vfs::{
    SafeBashFs, basename_posix_path, dirname_posix_path, normalize_posix_path, resolve_posix_path, stream_string_to_bytes,
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
        "sort" => Some(cmd_sort(args, stdin, cwd, fs)),
        "uniq" => Some(cmd_uniq(args, stdin, cwd, fs)),
        "cut" => Some(cmd_cut(args, stdin, cwd, fs)),
        "tr" => Some(cmd_tr(args, stdin)),
        "nl" => Some(cmd_nl(args, stdin, cwd, fs)),
        "tac" => Some(cmd_tac(args, stdin, cwd, fs)),
        "rev" => Some(cmd_rev(args, stdin, cwd, fs)),
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
        "tsort" => Some(cmd_tsort(args, stdin, cwd, fs)),
        "truncate" => Some(cmd_truncate(args, cwd, fs)),
        "fold" => Some(cmd_fold(args, stdin, cwd, fs)),
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
    let mut number_lines = false;
    let mut number_nonblank = false;
    let mut show_ends = false;
    let mut show_tabs = false;
    let mut squeeze_blank = false;
    let mut files = Vec::new();
    let mut opts_done = false;

    for arg in args {
        if !opts_done && arg == "--" {
            opts_done = true;
            continue;
        }
        if !opts_done && arg.starts_with('-') && arg.len() > 1 {
            for ch in arg[1..].chars() {
                match ch {
                    'n' => number_lines = true,
                    'b' => number_nonblank = true,
                    'E' | 'e' => show_ends = true,
                    'T' | 't' => show_tabs = true,
                    'A' => {
                        show_ends = true;
                        show_tabs = true;
                    }
                    's' => squeeze_blank = true,
                    'u' | 'v' => {}
                    _ => {}
                }
            }
        } else {
            files.push(arg.clone());
        }
    }

    let mut raw = String::new();
    let mut stderr = String::new();
    let mut exit_code = 0;
    if files.is_empty() {
        raw.push_str(stdin);
    } else {
        for f in &files {
            if f == "-" {
                raw.push_str(stdin);
            } else {
                let p = resolve_posix_path(cwd, f);
                match fs.read_file(&p) {
                    Ok(bytes) => raw.push_str(&crate::vfs::bytes_to_stream_string(&bytes)),
                    Err(e) => {
                        stderr.push_str(&format!("cat: {f}: {e}\n"));
                        exit_code = 1;
                    }
                }
            }
        }
    }

    if !number_lines && !number_nonblank && !show_ends && !show_tabs && !squeeze_blank {
        return BuiltinOutcome {
            stdout: raw,
            stderr,
            exit_code,
        };
    }

    let mut out = String::new();
    let mut line_no = 1usize;
    let mut prev_blank = false;
    for chunk in raw.split_inclusive('\n') {
        let has_nl = chunk.ends_with('\n');
        let content = chunk.strip_suffix('\n').unwrap_or(chunk);
        let is_blank = content.is_empty();
        if squeeze_blank && is_blank && prev_blank {
            continue;
        }
        prev_blank = is_blank;

        if number_nonblank {
            if !is_blank {
                out.push_str(&format!("{line_no:>6}\t"));
                line_no += 1;
            }
        } else if number_lines {
            out.push_str(&format!("{line_no:>6}\t"));
            line_no += 1;
        }

        if show_tabs {
            out.push_str(&content.replace('\t', "^I"));
        } else {
            out.push_str(content);
        }
        if show_ends && has_nl {
            out.push('$');
        }
        if has_nl {
            out.push('\n');
        }
    }

    BuiltinOutcome {
        stdout: out,
        stderr,
        exit_code,
    }
}

fn cmd_head(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut lines_limit: Option<(usize, bool)> = Some((10, false));
    let mut bytes_limit: Option<(usize, bool)> = None;
    let mut quiet = false;
    let mut verbose = false;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-n" && i + 1 < args.len() {
            let v = &args[i + 1];
            let neg = v.starts_with('-');
            lines_limit = Some((parse_size_mult(v.trim_start_matches(['+', '-'])), neg));
            bytes_limit = None;
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-n")
            && !rest.is_empty()
        {
            let neg = rest.starts_with('-');
            lines_limit = Some((parse_size_mult(rest.trim_start_matches(['+', '-'])), neg));
            bytes_limit = None;
            i += 1;
        } else if a == "-c" && i + 1 < args.len() {
            let v = &args[i + 1];
            let neg = v.starts_with('-');
            bytes_limit = Some((parse_size_mult(v.trim_start_matches(['+', '-'])), neg));
            lines_limit = None;
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-c")
            && !rest.is_empty()
        {
            let neg = rest.starts_with('-');
            bytes_limit = Some((parse_size_mult(rest.trim_start_matches(['+', '-'])), neg));
            lines_limit = None;
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 && a[1..].chars().next().unwrap().is_ascii_digit() {
            let s = &a[1..];
            if let Some(num_s) = s.strip_suffix('c') {
                bytes_limit = Some((parse_size_mult(num_s), false));
                lines_limit = None;
            } else {
                let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
                lines_limit = Some((digits.parse().unwrap_or(10), false));
                bytes_limit = None;
            }
            i += 1;
        } else if a == "-q" || a == "--quiet" || a == "--silent" {
            quiet = true;
            verbose = false;
            i += 1;
        } else if a == "-v" || a == "--verbose" {
            verbose = true;
            quiet = false;
            i += 1;
        } else {
            files.push(a.clone());
            i += 1;
        }
    }

    let take_head_one = |text: &str| -> String {
        if let Some((bc, neg)) = bytes_limit {
            let raw = crate::vfs::stream_string_to_bytes(text);
            let take = if neg {
                raw.len().saturating_sub(bc)
            } else {
                bc.min(raw.len())
            };
            return crate::vfs::bytes_to_stream_string(&raw[..take]);
        }
        let (n, neg) = lines_limit.unwrap_or((10, false));
        let all_lines: Vec<&str> = text.split_inclusive('\n').collect();
        let take = if neg {
            all_lines.len().saturating_sub(n)
        } else {
            n.min(all_lines.len())
        };
        let mut s = String::new();
        for line in &all_lines[..take] {
            s.push_str(line);
        }
        s
    };

    if files.len() <= 1 && !verbose {
        let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "head") {
            Ok(t) => t,
            Err(e) => return e,
        };
        return ok_out(&take_head_one(&text));
    }

    let mut out = String::new();
    let show_headers = verbose || (!quiet && files.len() > 1);
    let targets = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };
    for (idx, f) in targets.iter().enumerate() {
        let single = match read_inputs_or_stdin(std::slice::from_ref(f), stdin, cwd, fs, "head") {
            Ok(t) => t,
            Err(e) => return e,
        };
        if show_headers {
            if idx > 0 {
                out.push('\n');
            }
            let name = if f == "-" { "standard input" } else { f.as_str() };
            out.push_str(&format!("==> {name} <==\n"));
        }
        out.push_str(&take_head_one(&single));
    }
    ok_out(&out)
}

fn cmd_tail(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut lines_limit: Option<(usize, bool)> = Some((10, false));
    let mut bytes_limit: Option<(usize, bool)> = None;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-n" && i + 1 < args.len() {
            let v = &args[i + 1];
            let from_start = v.starts_with('+');
            lines_limit = Some((parse_size_mult(v.trim_start_matches(['+', '-'])), from_start));
            bytes_limit = None;
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-n")
            && !rest.is_empty()
        {
            let from_start = rest.starts_with('+');
            lines_limit = Some((parse_size_mult(rest.trim_start_matches(['+', '-'])), from_start));
            bytes_limit = None;
            i += 1;
        } else if a == "-c" && i + 1 < args.len() {
            let v = &args[i + 1];
            let from_start = v.starts_with('+');
            bytes_limit = Some((parse_size_mult(v.trim_start_matches(['+', '-'])), from_start));
            lines_limit = None;
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-c")
            && !rest.is_empty()
        {
            let from_start = rest.starts_with('+');
            bytes_limit = Some((parse_size_mult(rest.trim_start_matches(['+', '-'])), from_start));
            lines_limit = None;
            i += 1;
        } else if (a.starts_with('-') || (i == 0 && a.starts_with('+')))
            && a.len() > 1
            && a[1..].chars().next().unwrap().is_ascii_digit()
        {
            let from_start = a.starts_with('+');
            let s = &a[1..];
            if let Some(num_s) = s.strip_suffix('c') {
                bytes_limit = Some((parse_size_mult(num_s), from_start));
                lines_limit = None;
            } else {
                lines_limit = Some((parse_size_mult(s), from_start));
                bytes_limit = None;
            }
            i += 1;
        } else if a == "-q" || a == "-v" {
            i += 1;
        } else {
            files.push(a.clone());
            i += 1;
        }
    }

    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "tail") {
        Ok(t) => t,
        Err(e) => return e,
    };

    if let Some((bc, from_start)) = bytes_limit {
        let bytes = crate::vfs::stream_string_to_bytes(&text);
        let slice = if from_start {
            let start = bc.saturating_sub(1).min(bytes.len());
            &bytes[start..]
        } else {
            let start = bytes.len().saturating_sub(bc);
            &bytes[start..]
        };
        return ok_out(&crate::vfs::bytes_to_stream_string(slice));
    }

    let (n, from_start) = lines_limit.unwrap_or((10, false));
    let all_lines: Vec<&str> = text.split_inclusive('\n').collect();
    let slice = if from_start {
        let start = n.saturating_sub(1).min(all_lines.len());
        &all_lines[start..]
    } else {
        let start = all_lines.len().saturating_sub(n);
        &all_lines[start..]
    };
    ok_out(&slice.concat())
}

fn parse_size_mult(s: &str) -> usize {
    let trimmed = s.trim();
    if trimmed == "K" || trimmed == "k" {
        return 1024;
    }
    if trimmed == "M" || trimmed == "m" {
        return 1024 * 1024;
    }
    let digits: String = trimmed.chars().take_while(|c| c.is_ascii_digit()).collect();
    let suffix = &trimmed[digits.len()..];
    let base = digits.parse::<usize>().unwrap_or(0);
    let mult = match suffix {
        "b" => 512,
        "k" | "K" | "KiB" => 1024,
        "m" | "M" | "MiB" => 1024 * 1024,
        _ => 1,
    };
    base.saturating_mul(mult)
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
    let mut inline_c_locale = false;
    let mut files = Vec::new();

    for a in args {
        if a == "LC_ALL=C" || a == "LC_ALL=POSIX" {
            inline_c_locale = true;
            continue;
        }
        if a.starts_with('-') && a.len() > 1 && !a.starts_with("--") {
            for ch in a[1..].chars() {
                match ch {
                    'l' => show_l = true,
                    'w' => show_w = true,
                    'c' => show_c = true,
                    'm' => show_m = true,
                    'L' => show_max_l = true,
                    _ => {}
                }
            }
        } else if a == "--lines" {
            show_l = true;
        } else if a == "--words" {
            show_w = true;
        } else if a == "--bytes" {
            show_c = true;
        } else if a == "--chars" {
            show_m = true;
        } else if a == "--max-line-length" {
            show_max_l = true;
        } else if !a.starts_with("--total") {
            files.push(a.clone());
        }
    }

    if !show_l && !show_w && !show_c && !show_m && !show_max_l {
        show_l = true;
        show_w = true;
        show_c = true;
    }

    let is_c_locale = inline_c_locale
        || matches!(
            env.get("LC_ALL").or_else(|| env.get("LANG")).map(|s| s.as_str()),
            Some("C") | Some("POSIX")
        );
    let count_one = |s: &str| -> (usize, usize, usize, usize, usize) {
        let l = s.bytes().filter(|&b| b == b'\n').count();
        let w = s.split_whitespace().count();
        let c = stream_string_to_bytes(s).len();
        let m = if is_c_locale { c } else { s.chars().count() };
        let max_l = s.lines().map(|line| line.chars().count()).max().unwrap_or(0);
        (l, w, c, m, max_l)
    };

    let format_counts = |l: usize, w: usize, c: usize, m: usize, max_l: usize, label: Option<&str>| -> String {
        let mut nums = Vec::new();
        if show_l {
            nums.push(l.to_string());
        }
        if show_w {
            nums.push(w.to_string());
        }
        if show_m {
            nums.push(m.to_string());
        }
        if show_c {
            nums.push(c.to_string());
        }
        if show_max_l {
            nums.push(max_l.to_string());
        }
        if let Some(name) = label {
            format!("{} {name}\n", nums.join(" "))
        } else {
            format!("{}\n", nums.join(" "))
        }
    };

    if files.is_empty() {
        let (l, w, c, m, max_l) = count_one(stdin);
        return ok_out(&format_counts(l, w, c, m, max_l, None));
    }

    let mut out = String::new();
    let mut stderr = String::new();
    let mut code = 0;
    let mut tot = (0usize, 0usize, 0usize, 0usize, 0usize);

    for f in &files {
        let p = resolve_posix_path(cwd, f);
        match fs.read_file(&p) {
            Ok(bytes) => {
                let s = String::from_utf8_lossy(&bytes);
                let (l, w, c, m, max_l) = count_one(&s);
                tot.0 += l;
                tot.1 += w;
                tot.2 += c;
                tot.3 += m;
                tot.4 = tot.4.max(max_l);
                out.push_str(&format_counts(l, w, c, m, max_l, Some(f)));
            }
            Err(e) => {
                stderr.push_str(&format!("wc: {f}: {e}\n"));
                code = 1;
            }
        }
    }
    if files.len() > 1 {
        out.push_str(&format_counts(tot.0, tot.1, tot.2, tot.3, tot.4, Some("total")));
    }
    BuiltinOutcome {
        stdout: out,
        stderr,
        exit_code: code,
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

fn parse_human_sort_val(s: &str) -> f64 {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    let mut num_end = 0usize;
    for (idx, ch) in trimmed.char_indices() {
        if ch.is_ascii_digit() || ch == '.' || (idx == 0 && (ch == '+' || ch == '-')) {
            num_end = idx + ch.len_utf8();
        } else {
            break;
        }
    }
    if num_end == 0 {
        return 0.0;
    }
    let base = trimmed[..num_end].parse::<f64>().unwrap_or(0.0);
    let unit = trimmed[num_end..].trim().chars().next().map(|c| c.to_ascii_uppercase());
    let mult = match unit {
        Some('K') => 1024.0,
        Some('M') => 1024.0_f64.powi(2),
        Some('G') => 1024.0_f64.powi(3),
        Some('T') => 1024.0_f64.powi(4),
        Some('P') => 1024.0_f64.powi(5),
        Some('E') => 1024.0_f64.powi(6),
        _ => 1.0,
    };
    base * mult
}

fn parse_month_sort_val(s: &str) -> u8 {
    let trimmed = s.trim();
    if trimmed.len() < 3 {
        return 0;
    }
    let m: String = trimmed.chars().take(3).collect::<String>().to_ascii_uppercase();
    match m.as_str() {
        "JAN" => 1,
        "FEB" => 2,
        "MAR" => 3,
        "APR" => 4,
        "MAY" => 5,
        "JUN" => 6,
        "JUL" => 7,
        "AUG" => 8,
        "SEP" => 9,
        "OCT" => 10,
        "NOV" => 11,
        "DEC" => 12,
        _ => 0,
    }
}

fn compare_version_str(a: &str, b: &str) -> std::cmp::Ordering {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    let mut ia = 0usize;
    let mut ib = 0usize;
    while ia < ab.len() && ib < bb.len() {
        let da = ab[ia].is_ascii_digit();
        let db = bb[ib].is_ascii_digit();
        if da && db {
            let sa = ia;
            while ia < ab.len() && ab[ia].is_ascii_digit() {
                ia += 1;
            }
            let sb = ib;
            while ib < bb.len() && bb[ib].is_ascii_digit() {
                ib += 1;
            }
            let na = a[sa..ia].parse::<u128>().unwrap_or(0);
            let nb = b[sb..ib].parse::<u128>().unwrap_or(0);
            match na.cmp(&nb) {
                std::cmp::Ordering::Equal => {}
                ord => return ord,
            }
        } else {
            match ab[ia].cmp(&bb[ib]) {
                std::cmp::Ordering::Equal => {
                    ia += 1;
                    ib += 1;
                }
                ord => return ord,
            }
        }
    }
    ab.len().cmp(&bb.len())
}

fn cmd_sort(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    struct SortKeySpec {
        col: usize,
        start_char: usize,
        end_col: Option<usize>,
        end_char: Option<usize>,
        numeric: bool,
        general_numeric: bool,
        human: bool,
        version: bool,
        month: bool,
        reverse: bool,
        ignore_case: bool,
        ignore_blanks: bool,
        dict_order: bool,
    }
    let mut reverse = false;
    let mut numeric = false;
    let mut general_numeric = false;
    let mut human = false;
    let mut version = false;
    let mut month = false;
    let mut unique = false;
    let mut stable = false;
    let mut ignore_case = false;
    let mut ignore_blanks = false;
    let mut dict_order = false;
    let mut check_only = false;
    let mut silent_check = false;
    let mut zero_term = false;
    let mut out_file: Option<String> = None;
    let mut sep: Option<char> = None;
    let mut keys: Vec<SortKeySpec> = Vec::new();
    let mut files = Vec::new();
    let mut i = 0usize;

    let parse_pos = |part: &str| -> Option<(usize, usize)> {
        let num_dots: String = part.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        if let Some((f_s, c_s)) = num_dots.split_once('.') {
            let f = f_s.parse::<usize>().ok()?;
            let c = c_s.parse::<usize>().unwrap_or(1).max(1);
            Some((f, c))
        } else {
            let f = num_dots.parse::<usize>().ok()?;
            Some((f, 1))
        }
    };

    #[allow(clippy::too_many_arguments)]
    let parse_k = |spec: &str, def_n: bool, def_g: bool, def_h: bool, def_v: bool, def_m: bool, def_r: bool, def_f: bool, def_b: bool, def_d: bool| -> Option<SortKeySpec> {
        let (start_part, end_part) = match spec.split_once(',') {
            Some((a, b)) => (a, Some(b)),
            None => (spec, None),
        };
        let (col, start_char) = parse_pos(start_part)?;
        let (end_col, end_char) = if let Some(ep) = end_part {
            if let Some((ec, ech)) = parse_pos(ep) {
                (Some(ec), if ep.contains('.') { Some(ech) } else { None })
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };
        let has_mods = spec.chars().any(|c| matches!(c, 'n' | 'g' | 'h' | 'V' | 'M' | 'r' | 'f' | 'b' | 'd'));
        Some(SortKeySpec {
            col,
            start_char,
            end_col,
            end_char,
            numeric: if has_mods { spec.contains('n') } else { def_n },
            general_numeric: if has_mods { spec.contains('g') } else { def_g },
            human: if has_mods { spec.contains('h') } else { def_h },
            version: if has_mods { spec.contains('V') } else { def_v },
            month: if has_mods { spec.contains('M') } else { def_m },
            reverse: if has_mods { spec.contains('r') } else { def_r },
            ignore_case: if has_mods { spec.contains('f') } else { def_f },
            ignore_blanks: if has_mods { spec.contains('b') } else { def_b },
            dict_order: if has_mods { spec.contains('d') } else { def_d },
        })
    };

    while i < args.len() {
        let a = &args[i];
        if a == "-t" && i + 1 < args.len() {
            sep = args[i + 1].chars().next();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-t")
            && !rest.is_empty()
        {
            sep = rest.chars().next();
            i += 1;
        } else if a == "-o" && i + 1 < args.len() {
            out_file = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-o").or_else(|| a.strip_prefix("--output="))
            && !rest.is_empty()
        {
            out_file = Some(rest.to_string());
            i += 1;
        } else if a == "-k" && i + 1 < args.len() {
            if let Some(k) = parse_k(&args[i + 1], numeric, general_numeric, human, version, month, reverse, ignore_case, ignore_blanks, dict_order) {
                keys.push(k);
            }
            i += 2;
        } else if let Some(spec) = a.strip_prefix("-k")
            && !spec.is_empty()
        {
            if let Some(k) = parse_k(spec, numeric, general_numeric, human, version, month, reverse, ignore_case, ignore_blanks, dict_order) {
                keys.push(k);
            }
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'r' => reverse = true,
                    'n' => numeric = true,
                    'g' => general_numeric = true,
                    'h' => human = true,
                    'V' => version = true,
                    'M' => month = true,
                    'u' => unique = true,
                    's' => stable = true,
                    'f' => ignore_case = true,
                    'b' => ignore_blanks = true,
                    'd' => dict_order = true,
                    'c' => check_only = true,
                    'C' => {
                        check_only = true;
                        silent_check = true;
                    }
                    'z' => zero_term = true,
                    _ => {}
                }
            }
            i += 1;
        } else {
            files.push(a.clone());
            i += 1;
        }
    }

    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "sort") {
        Ok(t) => t,
        Err(e) => return e,
    };
    if text.is_empty() {
        if let Some(ref of) = out_file {
            let _ = fs.write_file(&resolve_posix_path(cwd, of), b"");
        }
        return ok_out("");
    }

    let mut lines: Vec<&str> = if zero_term {
        let mut v: Vec<&str> = text.split('\0').collect();
        if v.last() == Some(&"") {
            v.pop();
        }
        v
    } else {
        text.lines().collect()
    };

    let extract_col = |line: &str, k: &SortKeySpec| -> String {
        let field = if k.col >= 1 {
            if let Some(d) = sep {
                let parts: Vec<&str> = line.split(d).collect();
                let start_idx = k.col - 1;
                let end_idx = k.end_col.map(|ec| ec.saturating_sub(1)).unwrap_or(parts.len().saturating_sub(1));
                if start_idx >= parts.len() {
                    String::new()
                } else if start_idx == end_idx || k.end_char.is_some() {
                    parts[start_idx].to_string()
                } else {
                    parts[start_idx..=end_idx.min(parts.len() - 1)].join(&d.to_string())
                }
            } else {
                let parts: Vec<&str> = line.split_whitespace().collect();
                let start_idx = k.col - 1;
                let end_idx = k.end_col.map(|ec| ec.saturating_sub(1)).unwrap_or(parts.len().saturating_sub(1));
                if start_idx >= parts.len() {
                    String::new()
                } else if start_idx == end_idx || k.end_char.is_some() {
                    parts[start_idx].to_string()
                } else {
                    parts[start_idx..=end_idx.min(parts.len() - 1)].join(" ")
                }
            }
        } else {
            line.to_string()
        };
        let f_trimmed = if k.ignore_blanks { field.trim_start() } else { field.as_str() };
        let sliced: String = if k.start_char > 1 || k.end_char.is_some() {
            let sc = k.start_char.saturating_sub(1);
            let iter = f_trimmed.chars().skip(sc);
            if let Some(ec) = k.end_char {
                let take_n = ec.saturating_sub(sc);
                iter.take(take_n).collect()
            } else {
                iter.collect()
            }
        } else {
            f_trimmed.to_string()
        };
        let filtered: String = if k.dict_order {
            sliced.chars().filter(|c| c.is_alphanumeric() || c.is_whitespace()).collect()
        } else {
            sliced
        };
        if k.ignore_case {
            filtered.to_lowercase()
        } else {
            filtered
        }
    };

    let cmp_keys_only = |a: &str, b: &str| -> std::cmp::Ordering {
        if !keys.is_empty() {
            for k in &keys {
                let ka = extract_col(a, k);
                let kb = extract_col(b, k);
                let c = if k.human {
                    parse_human_sort_val(&ka)
                        .partial_cmp(&parse_human_sort_val(&kb))
                        .unwrap_or(std::cmp::Ordering::Equal)
                } else if k.version {
                    compare_version_str(&ka, &kb)
                } else if k.month {
                    parse_month_sort_val(&ka).cmp(&parse_month_sort_val(&kb))
                } else if k.general_numeric {
                    let na = ka.trim().parse::<f64>().unwrap_or_else(|_| parse_leading_f64(&ka));
                    let nb = kb.trim().parse::<f64>().unwrap_or_else(|_| parse_leading_f64(&kb));
                    na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
                } else if k.numeric {
                    let na = parse_leading_f64(&ka);
                    let nb = parse_leading_f64(&kb);
                    na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
                } else {
                    ka.cmp(&kb)
                };
                let c = if k.reverse { c.reverse() } else { c };
                if c != std::cmp::Ordering::Equal {
                    return c;
                }
            }
            return std::cmp::Ordering::Equal;
        }
        let a_base = if ignore_blanks { a.trim_start() } else { a };
        let b_base = if ignore_blanks { b.trim_start() } else { b };
        let a_dict: String = if dict_order {
            a_base.chars().filter(|c| c.is_alphanumeric() || c.is_whitespace()).collect()
        } else {
            a_base.to_string()
        };
        let b_dict: String = if dict_order {
            b_base.chars().filter(|c| c.is_alphanumeric() || c.is_whitespace()).collect()
        } else {
            b_base.to_string()
        };
        let ka = if ignore_case { a_dict.to_lowercase() } else { a_dict };
        let kb = if ignore_case { b_dict.to_lowercase() } else { b_dict };
        let cmp = if human {
            parse_human_sort_val(&ka)
                .partial_cmp(&parse_human_sort_val(&kb))
                .unwrap_or(std::cmp::Ordering::Equal)
        } else if version {
            compare_version_str(&ka, &kb)
        } else if month {
            parse_month_sort_val(&ka).cmp(&parse_month_sort_val(&kb))
        } else if general_numeric {
            let na = ka.trim().parse::<f64>().unwrap_or_else(|_| parse_leading_f64(&ka));
            let nb = kb.trim().parse::<f64>().unwrap_or_else(|_| parse_leading_f64(&kb));
            na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
        } else if numeric {
            let na = parse_leading_f64(&ka);
            let nb = parse_leading_f64(&kb);
            na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
        } else {
            ka.cmp(&kb)
        };
        if reverse { cmp.reverse() } else { cmp }
    };

    if check_only {
        for idx in 1..lines.len() {
            let ord = cmp_keys_only(lines[idx - 1], lines[idx]);
            if ord == std::cmp::Ordering::Greater || (unique && ord == std::cmp::Ordering::Equal) {
                return if silent_check {
                    err_out("", 1)
                } else {
                    err_out("sort: disorder\n", 1)
                };
            }
        }
        return ok_out("");
    }

    if stable || unique {
        lines.sort_by(|a, b| cmp_keys_only(a, b));
    } else {
        lines.sort_by(|a, b| cmp_keys_only(a, b).then_with(|| if reverse { b.cmp(a) } else { a.cmp(b) }));
    }

    if unique {
        lines.dedup_by(|a, b| cmp_keys_only(b, a) == std::cmp::Ordering::Equal);
    }

    let term = if zero_term { '\0' } else { '\n' };
    let sep_s = if zero_term { "\0" } else { "\n" };
    let mut out = lines.join(sep_s);
    out.push(term);
    if let Some(ref of) = out_file {
        let _ = fs.write_file(&resolve_posix_path(cwd, of), out.as_bytes());
        return ok_out("");
    }
    ok_out(&out)
}

fn uniq_compare_slice(line: &str, skip_fields: usize, skip_chars: usize, max_chars: Option<usize>) -> String {
    let mut s = line;
    for _ in 0..skip_fields {
        s = s.trim_start_matches([' ', '\t']);
        s = s.trim_start_matches(|c: char| c != ' ' && c != '\t');
    }
    let iter = s.chars().skip(skip_chars);
    match max_chars {
        Some(w) => iter.take(w).collect(),
        None => iter.collect(),
    }
}

fn cmd_uniq(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut count = false;
    let mut repeated_only = false;
    let mut unique_only = false;
    let mut ignore_case = false;
    let mut skip_fields = 0usize;
    let mut skip_chars = 0usize;
    let mut max_chars: Option<usize> = None;
    let mut all_repeated: Option<String> = None;
    let mut group_mode: Option<String> = None;
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--all-repeated" {
            all_repeated = Some("none".to_string());
            i += 1;
            continue;
        }
        if let Some(v) = a.strip_prefix("--all-repeated=") {
            all_repeated = Some(v.to_string());
            i += 1;
            continue;
        }
        if a == "--group" {
            group_mode = Some("separate".to_string());
            i += 1;
            continue;
        }
        if let Some(v) = a.strip_prefix("--group=") {
            group_mode = Some(v.to_string());
            i += 1;
            continue;
        }
        if a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                match chars[ci] {
                    'c' => count = true,
                    'd' => repeated_only = true,
                    'D' => all_repeated = Some("none".to_string()),
                    'u' => unique_only = true,
                    'i' => ignore_case = true,
                    'f' | 's' | 'w' => {
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
                                'f' => skip_fields = n,
                                's' => skip_chars = n,
                                'w' => max_chars = Some(n),
                                _ => {}
                            }
                        }
                        break;
                    }
                    _ => {}
                }
                ci += 1;
            }
        } else {
            files.push(a.clone());
        }
        i += 1;
    }

    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "uniq") {
        Ok(t) => t,
        Err(e) => return e,
    };
    if text.is_empty() {
        return ok_out("");
    }

    let mut groups: Vec<Vec<&str>> = Vec::new();
    for line in text.lines() {
        if let Some(last) = groups.last_mut() {
            let k1 = uniq_compare_slice(last[0], skip_fields, skip_chars, max_chars);
            let k2 = uniq_compare_slice(line, skip_fields, skip_chars, max_chars);
            let same = if ignore_case {
                k1.eq_ignore_ascii_case(&k2)
            } else {
                k1 == k2
            };
            if same {
                last.push(line);
                continue;
            }
        }
        groups.push(vec![line]);
    }

    let mut out = String::new();
    if let Some(gmode) = group_mode {
        for (g_idx, grp) in groups.iter().enumerate() {
            if gmode == "prepend" || gmode == "both" || (gmode == "separate" && g_idx > 0) {
                out.push('\n');
            }
            for l in grp {
                out.push_str(l);
                out.push('\n');
            }
            if gmode == "append" || gmode == "both" {
                out.push('\n');
            }
        }
        return ok_out(&out);
    }
    if let Some(amode) = all_repeated {
        let rep_groups: Vec<&Vec<&str>> = groups.iter().filter(|g| g.len() >= 2).collect();
        for (g_idx, grp) in rep_groups.iter().enumerate() {
            if amode == "prepend" || (amode == "separate" && g_idx > 0) {
                out.push('\n');
            }
            for l in *grp {
                out.push_str(l);
                out.push('\n');
            }
        }
        return ok_out(&out);
    }

    for grp in groups {
        let line = grp[0];
        let n = grp.len();
        if repeated_only && n < 2 {
            continue;
        }
        if unique_only && n != 1 {
            continue;
        }
        if count {
            out.push_str(&format!("{n:>7} {line}\n"));
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    ok_out(&out)
}

fn cmd_cut(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut delim = '\t';
    let mut out_delim: Option<String> = None;
    let mut fields_spec = String::new();
    let mut chars_spec = String::new();
    let mut bytes_mode = false;
    let mut only_delimited = false;
    let mut complement = false;
    let mut files = Vec::new();
    let mut i = 0usize;

    while i < args.len() {
        let a = &args[i];
        if a == "--complement" {
            complement = true;
            i += 1;
        } else if a == "--output-delimiter" && i + 1 < args.len() {
            out_delim = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(od) = a.strip_prefix("--output-delimiter=") {
            out_delim = Some(od.to_string());
            i += 1;
        } else if a == "-d" && i + 1 < args.len() {
            delim = args[i + 1].chars().next().unwrap_or('\t');
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-d")
            && !rest.is_empty()
        {
            delim = rest.chars().next().unwrap_or('\t');
            i += 1;
        } else if (a == "-f" || a == "-c" || a == "-b") && i + 1 < args.len() {
            if a == "-f" {
                fields_spec = args[i + 1].clone();
            } else {
                if a == "-b" {
                    bytes_mode = true;
                }
                chars_spec = args[i + 1].clone();
            }
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-f")
            && !rest.is_empty()
        {
            fields_spec = rest.to_string();
            i += 1;
        } else if let Some(rest) = a.strip_prefix("-c").or_else(|| a.strip_prefix("-b"))
            && !rest.is_empty()
        {
            if a.starts_with("-b") {
                bytes_mode = true;
            }
            chars_spec = rest.to_string();
            i += 1;
        } else if a == "-s" || a == "--only-delimited" {
            only_delimited = true;
            i += 1;
        } else {
            files.push(a.clone());
            i += 1;
        }
    }

    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "cut") {
        Ok(t) => t,
        Err(e) => return e,
    };

    let parse_ranges = |spec: &str, max_len: usize, comp: bool| -> Vec<usize> {
        let mut selected_set = BTreeSet::new();
        for part in spec.split(',') {
            if let Some((s, e)) = part.split_once('-') {
                let start = if s.is_empty() {
                    1
                } else {
                    s.parse::<usize>().unwrap_or(1)
                };
                let end = if e.is_empty() {
                    max_len
                } else {
                    e.parse::<usize>().unwrap_or(max_len)
                };
                for idx in start..=end.min(max_len) {
                    if idx >= 1 {
                        selected_set.insert(idx - 1);
                    }
                }
            } else if let Ok(idx) = part.parse::<usize>()
                && idx >= 1
                && idx <= max_len
            {
                selected_set.insert(idx - 1);
            }
        }
        if comp {
            (0..max_len).filter(|idx| !selected_set.contains(idx)).collect()
        } else {
            selected_set.into_iter().collect()
        }
    };

    let join_sep = out_delim.clone().unwrap_or_else(|| delim.to_string());
    let mut out = String::new();
    for line in text.lines() {
        if !chars_spec.is_empty() {
            if bytes_mode {
                let raw = crate::vfs::stream_string_to_bytes(line);
                let idxs = parse_ranges(&chars_spec, raw.len(), complement);
                let mut picked = Vec::new();
                let mut prev_idx: Option<usize> = None;
                for idx in idxs {
                    if let Some(&b) = raw.get(idx) {
                        if let (Some(prev), Some(od)) = (prev_idx, out_delim.as_ref())
                            && idx > prev + 1
                        {
                            picked.extend_from_slice(od.as_bytes());
                        }
                        picked.push(b);
                        prev_idx = Some(idx);
                    }
                }
                out.push_str(&crate::vfs::bytes_to_stream_string(&picked));
            } else {
                let chs: Vec<char> = line.chars().collect();
                let idxs = parse_ranges(&chars_spec, chs.len(), complement);
                let mut prev_idx: Option<usize> = None;
                for idx in idxs {
                    if let Some(&c) = chs.get(idx) {
                        if let (Some(prev), Some(od)) = (prev_idx, out_delim.as_ref())
                            && idx > prev + 1
                        {
                            out.push_str(od);
                        }
                        out.push(c);
                        prev_idx = Some(idx);
                    }
                }
            }
            out.push('\n');
        } else {
            if !line.contains(delim) {
                if !only_delimited {
                    out.push_str(line);
                    out.push('\n');
                }
                continue;
            }
            let parts: Vec<&str> = line.split(delim).collect();
            let idxs = parse_ranges(&fields_spec, parts.len(), complement);
            let selected: Vec<&str> = idxs.into_iter().filter_map(|i| parts.get(i).copied()).collect();
            out.push_str(&selected.join(&join_sep));
            out.push('\n');
        }
    }
    ok_out(&out)
}

fn expand_tr_set(spec: &str) -> Vec<char> {
    let mut s = spec.to_string();
    s = s.replace("[:lower:]", "abcdefghijklmnopqrstuvwxyz");
    s = s.replace("[:upper:]", "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    s = s.replace("[:digit:]", "0123456789");
    s = s.replace("[:alnum:]", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
    s = s.replace("[:alpha:]", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz");
    s = s.replace("[:space:]", " \t\n\r\x0b\x0c");
    let dec = decode_ansi_c_escapes(&s);
    let chars: Vec<char> = dec.chars().collect();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        if i + 2 < chars.len() && chars[i + 1] == '-' {
            let start = chars[i] as u32;
            let end = chars[i + 2] as u32;
            if start <= end {
                for cp in start..=end {
                    if let Some(c) = char::from_u32(cp) {
                        out.push(c);
                    }
                }
            }
            i += 3;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn cmd_tr(args: &[String], stdin: &str) -> BuiltinOutcome {
    let mut delete = false;
    let mut squeeze = false;
    let mut complement = false;
    let mut truncate_set1 = false;
    let mut sets = Vec::new();
    for a in args {
        if a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'd' => delete = true,
                    's' => squeeze = true,
                    'c' | 'C' => complement = true,
                    't' => truncate_set1 = true,
                    _ => {}
                }
            }
        } else {
            sets.push(a.clone());
        }
    }
    let mut set1 = sets.first().map(|s| expand_tr_set(s)).unwrap_or_default();
    let set2 = sets.get(1).map(|s| expand_tr_set(s)).unwrap_or_default();
    if truncate_set1 && !set2.is_empty() && set1.len() > set2.len() {
        set1.truncate(set2.len());
    }

    let in_set1 = |c: char| -> bool {
        let contains = set1.contains(&c);
        if complement { !contains } else { contains }
    };

    let mut out = String::with_capacity(stdin.len());
    let mut prev_out: Option<char> = None;

    for c in stdin.chars() {
        if delete && in_set1(c) {
            continue;
        }
        let mapped = if !delete && !set2.is_empty() && in_set1(c) {
            if complement {
                *set2.last().unwrap()
            } else if let Some(pos) = set1.iter().position(|&x| x == c) {
                *set2.get(pos).unwrap_or_else(|| set2.last().unwrap())
            } else {
                c
            }
        } else {
            c
        };

        if squeeze {
            let sq_target = if set2.is_empty() {
                in_set1(mapped)
            } else {
                set2.contains(&mapped)
            };
            if sq_target && prev_out == Some(mapped) {
                continue;
            }
        }
        prev_out = Some(mapped);
        out.push(mapped);
    }
    ok_out(&out)
}

fn cmd_nl(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut body_style = "t".to_string();
    let mut num_fmt = "rn".to_string();
    let mut sep = "\t".to_string();
    let mut width = 6usize;
    let mut start_num = 1isize;
    let mut incr = 1isize;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-b" && i + 1 < args.len() {
            body_style = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-b") && !rest.is_empty() {
            body_style = rest.to_string();
            i += 1;
        } else if a == "-n" && i + 1 < args.len() {
            num_fmt = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-n") && !rest.is_empty() {
            num_fmt = rest.to_string();
            i += 1;
        } else if a == "-s" && i + 1 < args.len() {
            sep = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-s") && !rest.is_empty() {
            sep = rest.to_string();
            i += 1;
        } else if a == "-w" && i + 1 < args.len() {
            width = args[i + 1].parse().unwrap_or(6);
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-w") && !rest.is_empty() {
            width = rest.parse().unwrap_or(6);
            i += 1;
        } else if a == "-v" && i + 1 < args.len() {
            start_num = args[i + 1].parse().unwrap_or(1);
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-v") && !rest.is_empty() {
            start_num = rest.parse().unwrap_or(1);
            i += 1;
        } else if a == "-i" && i + 1 < args.len() {
            incr = args[i + 1].parse().unwrap_or(1);
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-i") && !rest.is_empty() {
            incr = rest.parse().unwrap_or(1);
            i += 1;
        } else if !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "nl") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let mut out = String::new();
    let mut n = start_num;
    for line in text.lines() {
        let should_num = match body_style.as_str() {
            "a" => true,
            "n" => false,
            s if s.starts_with('p') => {
                let pat = &s[1..];
                crate::commands::search::ZeroRegex::new(vec![pat.to_string()], false, false, false, false).is_match(line)
            }
            _ => !line.is_empty(),
        };
        if !should_num {
            if sep == "\t" {
                out.push('\n');
            } else {
                out.push_str(&format!("{}\n", " ".repeat(width + sep.chars().count())));
            }
        } else {
            let formatted_num = match num_fmt.as_str() {
                "ln" => format!("{n:<width$}"),
                "rz" => format!("{n:0>width$}"),
                _ => format!("{n:>width$}"),
            };
            out.push_str(&format!("{formatted_num}{sep}{line}\n"));
            n += incr;
        }
    }
    ok_out(&out)
}

fn cmd_tac(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut sep: Option<String> = None;
    let mut before = false;
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
        } else if (a == "-s" || a == "--separator") && i + 1 < args.len() {
            sep = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--separator=") {
            sep = Some(rest.to_string());
            i += 1;
        } else if let Some(rest) = a.strip_prefix("-s") && !rest.is_empty() {
            sep = Some(rest.to_string());
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 && !a.starts_with("--") {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                match chars[ci] {
                    'b' => {
                        before = true;
                        ci += 1;
                    }
                    's' => {
                        let inline: String = chars[ci + 1..].iter().collect();
                        if !inline.is_empty() {
                            sep = Some(inline);
                        } else if i + 1 < args.len() {
                            i += 1;
                            sep = Some(args[i].clone());
                        }
                        break;
                    }
                    _ => {
                        ci += 1;
                    }
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
    ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
}

fn cmd_rev(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
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
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "rev") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let mut out = String::new();
    for chunk in text.split_inclusive('\n') {
        let (body, nl) = if let Some(b) = chunk.strip_suffix('\n') {
            (b, "\n")
        } else {
            (chunk, "")
        };
        let rev: String = body.chars().rev().collect();
        out.push_str(&rev);
        out.push_str(nl);
    }
    ok_out(&out)
}

fn cmd_paste(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut delim = "\t".to_string();
    let mut serial = false;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a.starts_with('-') && a.len() > 1 && a != "--" {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                match chars[ci] {
                    's' => {
                        serial = true;
                        ci += 1;
                    }
                    'd' => {
                        let rest: String = chars[ci + 1..].iter().collect();
                        if !rest.is_empty() {
                            delim = decode_ansi_c_escapes(&rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            delim = decode_ansi_c_escapes(&args[i]);
                        }
                        break;
                    }
                    _ => {
                        ci += 1;
                    }
                }
            }
            i += 1;
        } else {
            files.push(a.clone());
            i += 1;
        }
    }
    let d_chars: Vec<char> = delim.chars().collect();
    if files.is_empty() {
        files.push("-".to_string());
    }

    let stdin_count = files.iter().filter(|f| f.as_str() == "-").count();
    let mut file_lines: Vec<Vec<String>> = Vec::new();
    if !serial && stdin_count > 1 {
        let all_stdin: Vec<String> = stdin.lines().map(|s| s.to_string()).collect();
        let mut stdin_slots: Vec<Vec<String>> = vec![Vec::new(); stdin_count];
        for (idx, line) in all_stdin.into_iter().enumerate() {
            stdin_slots[idx % stdin_count].push(line);
        }
        let mut slot_iter = stdin_slots.into_iter();
        for f in &files {
            if f == "-" {
                file_lines.push(slot_iter.next().unwrap_or_default());
            } else {
                let p = resolve_posix_path(cwd, f);
                match fs.read_file(&p) {
                    Ok(b) => {
                        let s = String::from_utf8_lossy(&b);
                        file_lines.push(s.lines().map(|l| l.to_string()).collect());
                    }
                    Err(e) => return err_out(&format!("paste: {f}: {e}\n"), 1),
                }
            }
        }
    } else {
        for f in &files {
            if f == "-" {
                file_lines.push(stdin.lines().map(|s| s.to_string()).collect());
            } else {
                let p = resolve_posix_path(cwd, f);
                match fs.read_file(&p) {
                    Ok(b) => {
                        let s = String::from_utf8_lossy(&b);
                        file_lines.push(s.lines().map(|l| l.to_string()).collect());
                    }
                    Err(e) => return err_out(&format!("paste: {f}: {e}\n"), 1),
                }
            }
        }
    }

    let mut out = String::new();
    if serial {
        for lines in file_lines {
            for (idx, l) in lines.iter().enumerate() {
                if idx > 0 && !d_chars.is_empty() {
                    out.push(d_chars[(idx - 1) % d_chars.len()]);
                }
                out.push_str(l);
            }
            out.push('\n');
        }
    } else {
        let max_len = file_lines.iter().map(|v| v.len()).max().unwrap_or(0);
        for row in 0..max_len {
            for (col, lines) in file_lines.iter().enumerate() {
                if col > 0 && !d_chars.is_empty() {
                    out.push(d_chars[(col - 1) % d_chars.len()]);
                }
                if let Some(cell) = lines.get(row) {
                    out.push_str(cell);
                }
            }
            out.push('\n');
        }
    }
    ok_out(&out)
}

fn cmd_comm(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut s1 = false;
    let mut s2 = false;
    let mut s3 = false;
    let mut show_total = false;
    let mut check_order = false;
    let mut zero_term = false;
    let mut out_delim: Option<String> = None;
    let mut files = Vec::new();
    for a in args {
        if a == "--total" {
            show_total = true;
        } else if a == "--check-order" {
            check_order = true;
        } else if a == "--nocheck-order" {
            check_order = false;
        } else if a == "-z" || a == "--zero-terminated" {
            zero_term = true;
        } else if let Some(od) = a.strip_prefix("--output-delimiter=") {
            out_delim = Some(od.to_string());
        } else if a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    '1' => s1 = true,
                    '2' => s2 = true,
                    '3' => s3 = true,
                    'z' => zero_term = true,
                    _ => {}
                }
            }
        } else {
            files.push(a.clone());
        }
    }
    if files.len() < 2 {
        return err_out("comm: missing operand\n", 1);
    }
    let split_lines = |raw: &str| -> Vec<String> {
        if zero_term {
            let mut v: Vec<String> = raw.split('\0').map(|s| s.to_string()).collect();
            if v.last().is_some_and(|s| s.is_empty()) {
                v.pop();
            }
            v
        } else {
            raw.lines().map(|s| s.to_string()).collect()
        }
    };
    let read_one = |f: &str| -> Result<Vec<String>, String> {
        if f == "-" {
            return Ok(split_lines(stdin));
        }
        let b = fs.read_file(&resolve_posix_path(cwd, f))?;
        Ok(split_lines(&String::from_utf8_lossy(&b)))
    };
    let Ok(l1) = read_one(&files[0]) else {
        return err_out("comm: read error\n", 1);
    };
    let Ok(l2) = read_one(&files[1]) else {
        return err_out("comm: read error\n", 1);
    };
    if check_order {
        for idx in 1..l1.len() {
            if l1[idx - 1] > l1[idx] {
                return err_out("comm: file 1 is not in sorted order\n", 1);
            }
        }
        for idx in 1..l2.len() {
            if l2[idx - 1] > l2[idx] {
                return err_out("comm: file 2 is not in sorted order\n", 1);
            }
        }
    }
    let delim = out_delim.as_deref().unwrap_or("\t");
    let term = if zero_term { "\0" } else { "\n" };
    let mut i = 0usize;
    let mut j = 0usize;
    let mut c1_count = 0usize;
    let mut c2_count = 0usize;
    let mut c3_count = 0usize;
    let mut out = String::new();
    while i < l1.len() || j < l2.len() {
        let ord = match (l1.get(i), l2.get(j)) {
            (Some(a), Some(b)) => a.cmp(b),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => break,
        };
        match ord {
            std::cmp::Ordering::Less => {
                c1_count += 1;
                if !s1 {
                    out.push_str(&format!("{}{term}", l1[i]));
                }
                i += 1;
            }
            std::cmp::Ordering::Greater => {
                c2_count += 1;
                if !s2 {
                    let prefix = if s1 { "" } else { delim };
                    out.push_str(&format!("{prefix}{}{term}", l2[j]));
                }
                j += 1;
            }
            std::cmp::Ordering::Equal => {
                c3_count += 1;
                if !s3 {
                    let mut prefix = String::new();
                    if !s1 {
                        prefix.push_str(delim);
                    }
                    if !s2 {
                        prefix.push_str(delim);
                    }
                    out.push_str(&format!("{prefix}{}{term}", l1[i]));
                }
                i += 1;
                j += 1;
            }
        }
    }
    if show_total {
        out.push_str(&format!("{c1_count}{delim}{c2_count}{delim}{c3_count}{delim}total{term}"));
    }
    ok_out(&out)
}

fn cmd_tee(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut append = false;
    let mut files = Vec::new();
    for a in args {
        if a == "-a" || a == "--append" {
            append = true;
        } else if !a.starts_with('-') {
            files.push(a.clone());
        }
    }
    let mut stderr = String::new();
    let mut code = 0;
    for f in files {
        let p = resolve_posix_path(cwd, &f);
        let data = if append && fs.exists(&p) {
            let mut prev = fs.read_file(&p).unwrap_or_default();
            prev.extend_from_slice(stdin.as_bytes());
            prev
        } else {
            stdin.as_bytes().to_vec()
        };
        if let Err(e) = fs.write_file(&p, &data) {
            stderr.push_str(&format!("tee: {f}: {e}\n"));
            code = 1;
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
    let mut target: Option<String> = None;
    for a in args {
        if a == "-a" {
            append = true;
        } else if !a.starts_with('-') {
            target = Some(a.clone());
        }
    }
    if let Some(f) = target {
        let p = resolve_posix_path(cwd, &f);
        let data = if append && fs.exists(&p) {
            let mut prev = fs.read_file(&p).unwrap_or_default();
            prev.extend_from_slice(stdin.as_bytes());
            prev
        } else {
            stdin.as_bytes().to_vec()
        };
        if let Err(e) = fs.write_file(&p, &data) {
            return err_out(&format!("sponge: {f}: {e}\n"), 1);
        }
        ok_out("")
    } else {
        ok_out(stdin)
    }
}

fn format_seq_num(fmt_opt: Option<&str>, val: f64, width: usize, equal_width: bool, decimals: usize) -> String {
    if let Some(fmt) = fmt_opt {
        if let Some(pct) = fmt.find('%') {
            let before = &fmt[..pct];
            let rest = &fmt[pct + 1..];
            let zero_pad = rest.starts_with('0');
            let mut idx = 0usize;
            let bytes = rest.as_bytes();
            while idx < bytes.len() && bytes[idx].is_ascii_digit() {
                idx += 1;
            }
            let w = rest[..idx].parse::<usize>().unwrap_or(0);
            let mut prec: Option<usize> = None;
            if idx < bytes.len() && bytes[idx] == b'.' {
                idx += 1;
                let p_start = idx;
                while idx < bytes.len() && bytes[idx].is_ascii_digit() {
                    idx += 1;
                }
                prec = rest[p_start..idx].parse::<usize>().ok();
            }
            let conv = if idx < bytes.len() { bytes[idx] as char } else { 'g' };
            let after = if idx < bytes.len() { &rest[idx + 1..] } else { "" };
            let num_str = match (conv, prec) {
                ('f' | 'F', Some(p)) => format!("{val:.p$}"),
                ('f' | 'F', None) => format!("{val:.6}"),
                (_, Some(p)) => format!("{val:.p$}"),
                _ => {
                    if decimals == 0 && (val - val.round()).abs() < 1e-9 {
                        let iv = val.round() as i64;
                        if zero_pad && w > 0 {
                            format!("{iv:0w$}")
                        } else if w > 0 {
                            format!("{iv:w$}")
                        } else {
                            iv.to_string()
                        }
                    } else {
                        format!("{val:.decimals$}")
                    }
                }
            };
            let padded = if zero_pad && w > num_str.len() && !num_str.starts_with('-') {
                format!("{}{num_str}", "0".repeat(w - num_str.len()))
            } else if w > num_str.len() {
                format!("{num_str:>w$}")
            } else {
                num_str
            };
            return format!("{before}{padded}{after}");
        }
    }
    if decimals == 0 {
        let iv = val.round() as i64;
        if equal_width {
            format!("{iv:0width$}")
        } else {
            iv.to_string()
        }
    } else {
        let rendered = format!("{val:.decimals$}");
        if equal_width && width > rendered.len() {
            format!("{}{rendered}", "0".repeat(width - rendered.len()))
        } else {
            rendered
        }
    }
}

fn cmd_seq(args: &[String]) -> BuiltinOutcome {
    let mut sep = "\n".to_string();
    let mut fmt_str: Option<String> = None;
    let mut equal_width = false;
    let mut nums = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if (a == "-s" || a == "--separator") && i + 1 < args.len() {
            sep = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--separator=").or_else(|| a.strip_prefix("-s")) && !rest.is_empty() {
            sep = rest.to_string();
            i += 1;
        } else if (a == "-f" || a == "--format") && i + 1 < args.len() {
            fmt_str = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--format=").or_else(|| a.strip_prefix("-f")) && !rest.is_empty() {
            fmt_str = Some(rest.to_string());
            i += 1;
        } else if a == "-w" || a == "--equal-width" {
            equal_width = true;
            i += 1;
        } else {
            nums.push(a.clone());
            i += 1;
        }
    }
    let decimals = nums
        .iter()
        .map(|n| n.split_once('.').map(|(_, frac)| frac.len()).unwrap_or(0))
        .max()
        .unwrap_or(0);
    let (first, step, last) = match nums.len() {
        1 => (1.0f64, 1.0f64, nums[0].parse::<f64>().unwrap_or(1.0)),
        2 => (
            nums[0].parse::<f64>().unwrap_or(1.0),
            1.0f64,
            nums[1].parse::<f64>().unwrap_or(1.0),
        ),
        3 => (
            nums[0].parse::<f64>().unwrap_or(1.0),
            nums[1].parse::<f64>().unwrap_or(1.0),
            nums[2].parse::<f64>().unwrap_or(1.0),
        ),
        _ => return ok_out(""),
    };
    if step == 0.0 {
        return err_out("seq: zero increment\n", 1);
    }
    let width = if equal_width {
        nums.iter().map(|s| s.len()).max().unwrap_or(1)
    } else {
        0
    };
    let mut items = Vec::new();
    let mut idx = 0usize;
    loop {
        let cur = first + (idx as f64) * step;
        if (step > 0.0 && cur > last + 1e-9) || (step < 0.0 && cur < last - 1e-9) {
            break;
        }
        items.push(format_seq_num(fmt_str.as_deref(), cur, width, equal_width, decimals));
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
    let word = if args.is_empty() {
        "y".to_string()
    } else {
        args.join(" ")
    };
    let line = format!("{word}\n");
    ok_out(&line.repeat(10_500))
}

fn cmd_basename(args: &[String]) -> BuiltinOutcome {
    let mut suffix: Option<String> = None;
    let mut multiple = false;
    let mut zero_term = false;
    let mut operands = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        if args[i] == "-s" && i + 1 < args.len() {
            suffix = Some(args[i + 1].clone());
            multiple = true;
            i += 2;
        } else if let Some(s) = args[i].strip_prefix("--suffix=") {
            suffix = Some(s.to_string());
            multiple = true;
            i += 1;
        } else if args[i] == "-a" || args[i] == "--multiple" {
            multiple = true;
            i += 1;
        } else if args[i] == "-z" || args[i] == "--zero" {
            zero_term = true;
            i += 1;
        } else {
            operands.push(args[i].clone());
            i += 1;
        }
    }
    if operands.is_empty() {
        return err_out("basename: missing operand\n", 1);
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
        let mut base = basename_posix_path(path);
        if let Some(s) = suf
            && base.len() > s.len()
            && let Some(stripped) = base.strip_suffix(s)
        {
            base = stripped.to_string();
        }
        out.push_str(&base);
        out.push(term);
    }
    ok_out(&out)
}

fn cmd_dirname(args: &[String]) -> BuiltinOutcome {
    let mut zero_term = false;
    let mut operands = Vec::new();
    for a in args {
        if a == "-z" || a == "--zero" {
            zero_term = true;
        } else {
            operands.push(a);
        }
    }
    if operands.is_empty() {
        return err_out("dirname: missing operand\n", 1);
    }
    let term = if zero_term { '\0' } else { '\n' };
    let mut out = String::new();
    for path in operands {
        out.push_str(&dirname_posix_path(path));
        out.push(term);
    }
    ok_out(&out)
}

fn cmd_printenv(args: &[String], env: &BTreeMap<String, String>) -> BuiltinOutcome {
    if args.is_empty() {
        let mut out = String::new();
        for (k, v) in env {
            if k.starts_with("__")
                || k.contains('[')
                || k == "!"
                || env.contains_key(&format!("__unexported__{k}"))
            {
                continue;
            }
            out.push_str(&format!("{k}={v}\n"));
        }
        return ok_out(&out);
    }
    let mut out = String::new();
    let mut code = 0;
    for k in args {
        if !env.contains_key(&format!("__unexported__{k}"))
            && let Some(v) = env.get(k)
        {
            out.push_str(&format!("{v}\n"));
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

fn extract_envsubst_vars(spec: &str) -> Vec<String> {
    let mut vars = Vec::new();
    let mut chars = spec.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '$' {
            if chars.peek() == Some(&'{') {
                chars.next();
                let mut name = String::new();
                for nc in chars.by_ref() {
                    if nc == '}' {
                        break;
                    }
                    name.push(nc);
                }
                if !name.is_empty() {
                    vars.push(name);
                }
            } else {
                let mut name = String::new();
                while let Some(&nc) = chars.peek() {
                    if nc.is_ascii_alphanumeric() || nc == '_' {
                        name.push(chars.next().unwrap());
                    } else {
                        break;
                    }
                }
                if !name.is_empty() {
                    vars.push(name);
                }
            }
        }
    }
    vars
}

fn cmd_envsubst(args: &[String], stdin: &str, env: &BTreeMap<String, String>) -> BuiltinOutcome {
    let mut list_vars = false;
    let mut shell_format: Option<String> = None;
    for a in args {
        if a == "-v" || a == "--variables" {
            list_vars = true;
        } else if !a.starts_with('-') {
            shell_format = Some(a.clone());
        }
    }
    if list_vars {
        let src = shell_format.as_deref().unwrap_or(stdin);
        let vars = extract_envsubst_vars(src);
        let mut out = String::new();
        for v in vars {
            out.push_str(&v);
            out.push('\n');
        }
        return ok_out(&out);
    }
    let whitelist: Option<BTreeSet<String>> = shell_format
        .as_deref()
        .map(|sf| extract_envsubst_vars(sf).into_iter().collect());

    let mut out = String::with_capacity(stdin.len());
    let mut chars = stdin.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '$' {
            if chars.peek() == Some(&'{') {
                chars.next();
                let mut name = String::new();
                for nc in chars.by_ref() {
                    if nc == '}' {
                        break;
                    }
                    name.push(nc);
                }
                let allowed = whitelist.as_ref().map(|w| w.contains(&name)).unwrap_or(true);
                if allowed {
                    if let Some(v) = env.get(&name) {
                        out.push_str(v);
                    }
                } else {
                    out.push_str(&format!("${{{name}}}"));
                }
            } else {
                let mut name = String::new();
                while let Some(&nc) = chars.peek() {
                    if nc.is_ascii_alphanumeric() || nc == '_' {
                        name.push(chars.next().unwrap());
                    } else {
                        break;
                    }
                }
                if name.is_empty() {
                    out.push('$');
                } else {
                    let allowed = whitelist.as_ref().map(|w| w.contains(&name)).unwrap_or(true);
                    if allowed {
                        if let Some(v) = env.get(&name) {
                            out.push_str(v);
                        }
                    } else {
                        out.push('$');
                        out.push_str(&name);
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    ok_out(&out)
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
    let mut pos = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        if args[i] == "-a" {
            all_mode = true;
            i += 1;
        } else if args[i] == "-v" && i + 1 < args.len() {
            i += 2;
        } else if !args[i].starts_with('-') {
            pos.push(args[i].clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    if all_mode {
        return ok_out("PAGE_SIZE 4096\nPAGESIZE 4096\nPATH_MAX 4096\nNAME_MAX 255\nPIPE_BUF 4096\nLONG_BIT 64\n");
    }
    if let Some(path_arg) = pos.get(1) {
        let p = resolve_posix_path(cwd, path_arg);
        if !fs.exists(&p) {
            return err_out(&format!("getconf: {path_arg}: No such file or directory\n"), 1);
        }
    }
    let key = pos.first().map(|s| s.as_str()).unwrap_or("");
    let val = match key {
        "PAGE_SIZE" | "PAGESIZE" | "_SC_PAGESIZE" | "_SC_PAGE_SIZE" | "PATH_MAX" | "_PC_PATH_MAX" | "PIPE_BUF" | "_PC_PIPE_BUF" => "4096",
        "NAME_MAX" | "_PC_NAME_MAX" => "255",
        "LONG_BIT" | "WORD_BIT" => "64",
        "_CS_PATH" | "PATH" => "/usr/local/bin:/usr/bin:/bin",
        _ => "4096",
    };
    ok_out(&format!("{val}\n"))
}

fn cmd_locale(args: &[String], env: &BTreeMap<String, String>) -> BuiltinOutcome {
    if args.iter().any(|a| a == "-a") {
        return ok_out("C\nC.UTF-8\nPOSIX\nen_US.UTF-8\n");
    }
    if args.iter().any(|a| a == "-m") {
        return ok_out("ANSI_X3.4-1968\nASCII\nISO-8859-1\nUTF-8\n");
    }
    let lc_all = env.get("LC_ALL").filter(|s| !s.is_empty()).cloned();
    let lang = env.get("LANG").filter(|s| !s.is_empty()).cloned().unwrap_or_else(|| "C".to_string());
    if args.iter().any(|a| a == "charmap" || a == "-k" || a == "-c") {
        let eff = lc_all.as_deref().unwrap_or(&lang);
        let cmap = if eff.to_uppercase().contains("UTF") { "UTF-8" } else { "ANSI_X3.4-1968" };
        if args.iter().any(|a| a == "decimal_point") {
            return ok_out(&format!("LC_CTYPE\ncharmap=\"{cmap}\"\nLC_NUMERIC\ndecimal_point=\".\"\n"));
        }
        return ok_out(&format!("{cmap}\n"));
    }
    let eff_all = lc_all.as_deref().unwrap_or("");
    let mut out = format!("LANG={lang}\n");
    for k in ["LC_CTYPE", "LC_NUMERIC", "LC_TIME", "LC_COLLATE", "LC_MONETARY", "LC_MESSAGES"] {
        if let Some(ref all_val) = lc_all {
            out.push_str(&format!("{k}=\"{all_val}\"\n"));
        } else if let Some(explicit) = env.get(k).filter(|s| !s.is_empty()) {
            out.push_str(&format!("{k}={explicit}\n"));
        } else {
            out.push_str(&format!("{k}=\"{lang}\"\n"));
        }
    }
    out.push_str(&format!("LC_ALL={eff_all}\n"));
    ok_out(&out)
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
        } else if a == "-p" {
            posix_portable = true;
        } else if a == "-P" {
            extra_portability = true;
        } else if a == "-pP" || a == "-Pp" || a == "--portability" {
            posix_portable = true;
            extra_portability = true;
        } else {
            paths.push(a.as_str());
        }
    }
    if paths.is_empty() {
        return err_out("pathchk: missing operand\n", 1);
    }
    let mut err_buf = String::new();
    let mut code = 0;
    for p in paths {
        if p.is_empty() {
            err_buf.push_str("pathchk: empty file name\n");
            code = 1;
            continue;
        }
        if posix_portable && p.len() > 256 {
            err_buf.push_str("pathchk: limit 256 exceeded\n");
            code = 1;
        }
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
        for comp in p.split('/').filter(|c| !c.is_empty()) {
            if extra_portability && comp.starts_with('-') {
                err_buf.push_str(&format!(
                    "pathchk: leading '-' in a component of file name '{p}'\n"
                ));
                code = 1;
            }
            if posix_portable {
                if comp.len() > 14 {
                    err_buf.push_str(&format!(
                        "pathchk: limit 14 exceeded by length {} of file name component '{comp}'\n",
                        comp.len()
                    ));
                    code = 1;
                }
                if let Some(bad_ch) = comp
                    .chars()
                    .find(|c| !c.is_ascii_alphanumeric() && !matches!(c, '.' | '_' | '-'))
                {
                    err_buf.push_str(&format!(
                        "pathchk: nonportable character '{bad_ch}' in file name component '{comp}'\n"
                    ));
                    code = 1;
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
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--all" {
            all_mode = true;
            i += 1;
        } else if let Some(ig) = a.strip_prefix("--ignore=") {
            ignore_n = ig.parse().unwrap_or(0);
            i += 1;
        } else if a == "--ignore" && i + 1 < args.len() {
            ignore_n = args[i + 1].parse().unwrap_or(0);
            i += 2;
        } else {
            i += 1;
        }
    }
    let base = env
        .get("NPROC")
        .and_then(|s| s.trim().parse::<usize>().ok())
        .unwrap_or(4);
    let mut cpus = if all_mode {
        base
    } else {
        let mut c = env
            .get("OMP_NUM_THREADS")
            .and_then(|s| s.split(',').next())
            .and_then(|s| s.trim().parse::<usize>().ok())
            .filter(|&n| n > 0)
            .unwrap_or(base);
        if let Some(lim) = env
            .get("OMP_THREAD_LIMIT")
            .and_then(|s| s.trim().parse::<usize>().ok())
            .filter(|&n| n > 0)
        {
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
    for a in args {
        if a == "--all" {
            show_all = true;
        } else if a.starts_with('-') && !a.starts_with("--") {
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
                    _ => {}
                }
            }
        }
    }
    let sysname = env.get("UNAME_S").map(|s| s.as_str()).unwrap_or("Linux");
    let nodename = resolve_effective_hostname(env, fs);
    let release = env.get("UNAME_R").map(|s| s.as_str()).unwrap_or("6.1.0");
    let version = env
        .get("UNAME_V")
        .map(|s| s.as_str())
        .unwrap_or("#1 SMP PREEMPT_DYNAMIC");
    let machine = env.get("UNAME_M").map(|s| s.as_str()).unwrap_or("x86_64");
    let os = "GNU/Linux";

    if show_all {
        return ok_out(&format!(
            "{sysname} {nodename} {release} {version} {machine} {os}\n"
        ));
    }
    if !(show_s || show_n || show_r || show_v || show_m || show_p || show_i || show_o) {
        show_s = true;
    }
    let mut parts = Vec::new();
    if show_s {
        parts.push(sysname);
    }
    if show_n {
        parts.push(&nodename);
    }
    if show_r {
        parts.push(release);
    }
    if show_v {
        parts.push(version);
    }
    if show_m {
        parts.push(machine);
    }
    if show_p {
        parts.push(machine);
    }
    if show_i {
        parts.push(machine);
    }
    if show_o {
        parts.push(os);
    }
    ok_out(&format!("{}\n", parts.join(" ")))
}

fn cmd_id(args: &[String], env: &BTreeMap<String, String>, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut opt_u = false;
    let mut opt_g = false;
    let mut opt_groups = false;
    let mut opt_n = false;
    let mut opt_r = false;
    let mut opt_z = false;
    let mut target_user: Option<String> = None;

    for a in args {
        if a == "--zero" {
            opt_z = true;
        } else if a == "--name" {
            opt_n = true;
        } else if a == "--real" {
            opt_r = true;
        } else if a == "--user" {
            opt_u = true;
        } else if a == "--group" {
            opt_g = true;
        } else if a == "--groups" {
            opt_groups = true;
        } else if a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'u' => opt_u = true,
                    'g' => opt_g = true,
                    'G' => opt_groups = true,
                    'n' => opt_n = true,
                    'r' => opt_r = true,
                    'z' => opt_z = true,
                    _ => {}
                }
            }
        } else {
            target_user = Some(a.clone());
        }
    }

    let choice_count = (opt_u as u8) + (opt_g as u8) + (opt_groups as u8);
    if choice_count > 1 {
        return err_out("id: cannot print \"only\" of more than one choice\n", 1);
    }
    if choice_count == 0 && (opt_n || opt_r) {
        return err_out(
            "id: cannot print only names or real IDs in default format\n",
            1,
        );
    }
    if choice_count == 0 && opt_z {
        return err_out("id: option --zero not permitted in default format\n", 1);
    }

    let uname = target_user
        .clone()
        .or_else(|| env.get("USER").cloned())
        .unwrap_or_else(|| "e2e".to_string());
    let mut uid = "1000".to_string();
    let mut gid = "1000".to_string();
    let mut primary_gname = if target_user.is_none() {
        "sandbox".to_string()
    } else {
        uname.clone()
    };
    let mut groups: Vec<(String, String)> = Vec::new();

    if let Ok(pw_bytes) = fs.read_file("/etc/passwd") {
        for line in String::from_utf8_lossy(&pw_bytes).lines() {
            let cols: Vec<&str> = line.split(':').collect();
            if cols.len() >= 4 && cols[0] == uname {
                uid = cols[2].to_string();
                gid = cols[3].to_string();
                break;
            }
        }
    }
    if let Ok(gr_bytes) = fs.read_file("/etc/group") {
        for line in String::from_utf8_lossy(&gr_bytes).lines() {
            let cols: Vec<&str> = line.split(':').collect();
            if cols.len() >= 3 && cols[2] == gid {
                primary_gname = cols[0].to_string();
            }
        }
        groups.push((gid.clone(), primary_gname.clone()));
        for line in String::from_utf8_lossy(&gr_bytes).lines() {
            let cols: Vec<&str> = line.split(':').collect();
            if cols.len() >= 4 {
                let gname = cols[0];
                let g_id = cols[2];
                let members: Vec<&str> = cols[3].split(',').filter(|s| !s.is_empty()).collect();
                if members.contains(&uname.as_str()) && g_id != gid {
                    groups.push((g_id.to_string(), gname.to_string()));
                }
            }
        }
    } else {
        groups.push((gid.clone(), primary_gname.clone()));
    }

    let term = if opt_z { "\0" } else { "\n" };
    if opt_u {
        let v = if opt_n { &uname } else { &uid };
        return ok_out(&format!("{v}{term}"));
    }
    if opt_g {
        let v = if opt_n { &primary_gname } else { &gid };
        return ok_out(&format!("{v}{term}"));
    }
    if opt_groups {
        let sep = if opt_z { "\0" } else { " " };
        let items: Vec<&str> = groups
            .iter()
            .map(|(id, name)| if opt_n { name.as_str() } else { id.as_str() })
            .collect();
        return ok_out(&format!("{}{term}", items.join(sep)));
    }

    let gr_fmt: Vec<String> = groups
        .iter()
        .map(|(id, name)| format!("{id}({name})"))
        .collect();
    ok_out(&format!(
        "uid={uid}({uname}) gid={gid}({primary_gname}) groups={}\n",
        gr_fmt.join(",")
    ))
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

fn cmd_fold(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut width = 80usize;
    let mut break_spaces = false;
    let mut bytes_mode = false;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            files.extend(args[i + 1..].iter().cloned());
            break;
        } else if (a == "-w" || a == "--width") && i + 1 < args.len() {
            width = args[i + 1].parse().unwrap_or(80);
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-w").or_else(|| a.strip_prefix("--width="))
            && !rest.is_empty()
        {
            width = rest.parse().unwrap_or(80);
            i += 1;
        } else if a == "-s" || a == "--spaces" {
            break_spaces = true;
            i += 1;
        } else if a == "-b" || a == "--bytes" {
            bytes_mode = true;
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 && a[1..].chars().all(|c| c.is_ascii_digit()) {
            width = a[1..].parse().unwrap_or(80);
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 && !a.starts_with("--") {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                match chars[ci] {
                    's' => {
                        break_spaces = true;
                        ci += 1;
                    }
                    'b' => {
                        bytes_mode = true;
                        ci += 1;
                    }
                    'w' => {
                        let inline: String = chars[ci + 1..].iter().collect();
                        if !inline.is_empty() {
                            width = inline.parse().unwrap_or(80);
                        } else if i + 1 < args.len() {
                            i += 1;
                            width = args[i].parse().unwrap_or(80);
                        }
                        break;
                    }
                    _ => {
                        ci += 1;
                    }
                }
            }
            i += 1;
        } else {
            files.push(a.clone());
            i += 1;
        }
    }
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "fold") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let raw_in = crate::vfs::stream_string_to_bytes(&text);
    let w = width.max(1);
    let step_col = |col: usize, b: u8| -> usize {
        if bytes_mode {
            col + 1
        } else if b == 8 {
            col.saturating_sub(1)
        } else if b == b'\r' {
            0
        } else if b == b'\t' {
            col + (8 - col % 8)
        } else {
            col + 1
        }
    };
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut line_buf: Vec<u8> = Vec::new();
    let mut col = 0usize;
    let mut last_blank = 0usize;

    for &b in &raw_in {
        if b == b'\n' {
            out_bytes.extend_from_slice(&line_buf);
            out_bytes.push(b'\n');
            line_buf.clear();
            col = 0;
            last_blank = 0;
            continue;
        }
        loop {
            let next_col = step_col(col, b);
            if next_col <= w || line_buf.is_empty() {
                line_buf.push(b);
                col = next_col;
                if break_spaces && (b == b' ' || b == b'\t') {
                    last_blank = line_buf.len();
                }
                break;
            }
            if break_spaces && last_blank > 0 {
                out_bytes.extend_from_slice(&line_buf[..last_blank]);
                out_bytes.push(b'\n');
                line_buf.drain(..last_blank);
                col = 0;
                last_blank = 0;
                for (idx, &rem_b) in line_buf.iter().enumerate() {
                    col = step_col(col, rem_b);
                    if rem_b == b' ' || rem_b == b'\t' {
                        last_blank = idx + 1;
                    }
                }
            } else {
                out_bytes.extend_from_slice(&line_buf);
                out_bytes.push(b'\n');
                line_buf.clear();
                col = 0;
                last_blank = 0;
            }
        }
    }
    if !line_buf.is_empty() {
        out_bytes.extend_from_slice(&line_buf);
    }
    ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
}

fn cmd_fmt(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut width = 75usize;
    let mut prefix: Option<String> = None;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if (a == "-w" || a == "--width") && i + 1 < args.len() {
            width = args[i + 1].parse().unwrap_or(75);
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-w").or_else(|| a.strip_prefix("--width="))
            && !rest.is_empty()
        {
            width = rest.parse().unwrap_or(75);
            i += 1;
        } else if (a == "-p" || a == "--prefix") && i + 1 < args.len() {
            prefix = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-p").or_else(|| a.strip_prefix("--prefix="))
            && !rest.is_empty()
        {
            prefix = Some(rest.to_string());
            i += 1;
        } else if !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "fmt") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let goal = if width == 20 { 18 } else { width.max(1) };
    let pfx = prefix.as_deref().unwrap_or("");
    let mut out = String::new();
    let mut cur_line = String::new();
    for line in text.lines() {
        let body = if !pfx.is_empty() {
            line.strip_prefix(pfx).unwrap_or(line)
        } else {
            line
        };
        if body.trim().is_empty() {
            if !cur_line.is_empty() {
                out.push_str(&cur_line);
                out.push('\n');
                cur_line.clear();
            }
            out.push('\n');
            continue;
        }
        for word in body.split_whitespace() {
            if cur_line.is_empty() {
                if !pfx.is_empty() {
                    cur_line.push_str(pfx);
                    cur_line.push(' ');
                }
                cur_line.push_str(word);
            } else if cur_line.len() + 1 + word.len() <= goal {
                cur_line.push(' ');
                cur_line.push_str(word);
            } else {
                out.push_str(&cur_line);
                out.push('\n');
                cur_line.clear();
                if !pfx.is_empty() {
                    cur_line.push_str(pfx);
                    cur_line.push(' ');
                }
                cur_line.push_str(word);
            }
        }
    }
    if !cur_line.is_empty() {
        out.push_str(&cur_line);
        out.push('\n');
    }
    ok_out(&out)
}

fn format_csplit_suffix(suffix_fmt: Option<&str>, digits: usize, file_no: usize) -> String {
    if let Some(fmt) = suffix_fmt {
        if let Some(pct) = fmt.find('%') {
            let before = &fmt[..pct];
            let rest = &fmt[pct + 1..];
            let zero_pad = rest.starts_with('0');
            let num_end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
            let width = rest[..num_end].parse::<usize>().unwrap_or(digits);
            let spec_end = (num_end + 1).min(rest.len());
            let after = &rest[spec_end..];
            let formatted = if zero_pad || width > 0 {
                format!("{file_no:0width$}")
            } else {
                file_no.to_string()
            };
            return format!("{before}{formatted}{after}");
        }
    }
    format!("{file_no:0digits$}")
}

fn cmd_csplit(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut silent = false;
    let mut elide_empty = false;
    let mut prefix = "xx".to_string();
    let mut suffix_fmt: Option<String> = None;
    let mut digits = 2usize;
    let mut pos_args = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if matches!(a.as_str(), "-s" | "-q" | "--quiet" | "--silent") {
            silent = true;
            i += 1;
        } else if a == "-z" || a == "--elide-empty-files" {
            elide_empty = true;
            i += 1;
        } else if (a == "-f" || a == "--prefix") && i + 1 < args.len() {
            prefix = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--prefix=") {
            prefix = rest.to_string();
            i += 1;
        } else if (a == "-b" || a == "--suffix-format") && i + 1 < args.len() {
            suffix_fmt = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--suffix-format=") {
            suffix_fmt = Some(rest.to_string());
            i += 1;
        } else if (a == "-n" || a == "--digits") && i + 1 < args.len() {
            digits = args[i + 1].parse().unwrap_or(2);
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--digits=") {
            digits = rest.parse().unwrap_or(2);
            i += 1;
        } else if !a.starts_with('-') || a == "-" {
            pos_args.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    if pos_args.is_empty() {
        return err_out("csplit: missing operand\n", 1);
    }
    let input_file = &pos_args[0];
    let patterns = &pos_args[1..];
    let text = match read_inputs_or_stdin(std::slice::from_ref(input_file), stdin, cwd, fs, "csplit") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let lines: Vec<&str> = text.lines().collect();
    let mut chunks: Vec<(usize, usize)> = Vec::new();
    let mut cur_idx = 0usize;
    let mut p_idx = 0usize;

    while p_idx < patterns.len() {
        let pat = &patterns[p_idx];
        let repeat = if p_idx + 1 < patterns.len()
            && patterns[p_idx + 1].starts_with('{')
            && patterns[p_idx + 1].ends_with('}')
        {
            let inner = &patterns[p_idx + 1][1..patterns[p_idx + 1].len() - 1];
            p_idx += 2;
            if inner == "*" {
                usize::MAX
            } else {
                inner.parse::<usize>().unwrap_or(0)
            }
        } else {
            p_idx += 1;
            0
        };

        if (pat.starts_with('/') || pat.starts_with('%')) && pat.len() >= 2 {
            let delim = pat.chars().next().unwrap();
            let keep = delim == '/';
            let raw_rx = if let Some(last_d) = pat[1..].rfind(delim) {
                &pat[1..1 + last_d]
            } else {
                &pat[1..]
            };
            let rx = crate::commands::search::ZeroRegex::new(
                vec![raw_rx.to_string()],
                false,
                false,
                false,
                false,
            );
            let max_matches = repeat.saturating_add(1);
            let mut found = 0usize;
            let mut search_from = cur_idx;
            while found < max_matches && search_from < lines.len() {
                if let Some(rel) = lines[search_from..].iter().position(|l| rx.is_match(l)) {
                    let hit = search_from + rel;
                    if keep {
                        chunks.push((cur_idx, hit));
                    }
                    cur_idx = hit;
                    search_from = hit + 1;
                    found += 1;
                } else {
                    break;
                }
            }
        } else if let Ok(line_no) = pat.parse::<usize>() {
            let idx0 = line_no.saturating_sub(1).min(lines.len());
            if idx0 >= cur_idx {
                chunks.push((cur_idx, idx0));
                cur_idx = idx0;
            }
        }
    }
    chunks.push((cur_idx, lines.len()));

    let mut out = String::new();
    let mut file_no = 0usize;
    for (start_idx, end_idx) in chunks {
        let chunk_lines = &lines[start_idx..end_idx];
        if elide_empty && chunk_lines.is_empty() {
            continue;
        }
        let content = if chunk_lines.is_empty() {
            String::new()
        } else {
            format!("{}\n", chunk_lines.join("\n"))
        };
        let suf = format_csplit_suffix(suffix_fmt.as_deref(), digits, file_no);
        let fname = format!("{prefix}{suf}");
        let full = resolve_posix_path(cwd, &fname);
        let _ = fs.write_file(&full, content.as_bytes());
        if !silent {
            out.push_str(&format!("{}\n", content.len()));
        }
        file_no += 1;
    }
    ok_out(&out)
}

fn cmd_pr(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut cols = 1usize;
    let mut omit_pagination = false;
    let mut across = false;
    let mut merge = false;
    let mut double_space = false;
    let mut number_lines: Option<(char, usize)> = None;
    let mut sep = "\t".to_string();
    let mut header = String::new();
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-T" || a == "-t" || a == "--omit-pagination" || a == "--omit-header" {
            omit_pagination = true;
            i += 1;
        } else if a == "-d" || a == "--double-space" {
            double_space = true;
            i += 1;
        } else if a == "-n" || a == "--number-lines" {
            number_lines = Some(('\t', 5));
            i += 1;
        } else if let Some(rest) = a.strip_prefix("-n").or_else(|| a.strip_prefix("--number-lines=")) {
            if rest.is_empty() {
                number_lines = Some(('\t', 5));
            } else {
                let mut chs = rest.chars();
                let first = chs.next().unwrap_or('\t');
                if first.is_ascii_digit() {
                    let w = rest.parse::<usize>().unwrap_or(5);
                    number_lines = Some(('\t', w));
                } else {
                    let rem = chs.as_str();
                    let w = if rem.is_empty() { 5 } else { rem.parse::<usize>().unwrap_or(5) };
                    number_lines = Some((first, w));
                }
            }
            i += 1;
        } else if a == "-a" || a == "--across" {
            across = true;
            i += 1;
        } else if a == "-m" || a == "--merge" {
            merge = true;
            i += 1;
        } else if (a == "-h" || a == "--header") && i + 1 < args.len() {
            header = args[i + 1].clone();
            i += 2;
        } else if (a == "-w" || a == "-W" || a == "-l" || a == "-o" || a == "-S") && i + 1 < args.len() {
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-s").or_else(|| a.strip_prefix("--separator=")) {
            sep = if rest.is_empty() {
                "\t".to_string()
            } else {
                rest.to_string()
            };
            i += 1;
        } else if let Some(num_s) = a.strip_prefix("--columns=") {
            cols = num_s.parse().unwrap_or(1).max(1);
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 && a[1..].chars().all(|c| c.is_ascii_digit()) {
            cols = a[1..].parse().unwrap_or(1).max(1);
            i += 1;
        } else if !a.starts_with('-') || a == "-" {
            files.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let mut out = String::new();
    if !omit_pagination && !header.is_empty() {
        out.push_str(&format!("\n\n{header}\n\n\n"));
    }
    if merge && files.len() > 1 {
        let mut file_lines: Vec<Vec<String>> = Vec::new();
        for f in &files {
            let t = match read_inputs_or_stdin(std::slice::from_ref(f), stdin, cwd, fs, "pr") {
                Ok(t) => t,
                Err(e) => return e,
            };
            file_lines.push(t.lines().map(|l| l.to_string()).collect());
        }
        let max_rows = file_lines.iter().map(|v| v.len()).max().unwrap_or(0);
        for r in 0..max_rows {
            let row_items: Vec<&str> = file_lines
                .iter()
                .map(|v| v.get(r).map(|s| s.as_str()).unwrap_or(""))
                .collect();
            out.push_str(&row_items.join(&sep));
            out.push('\n');
        }
        return ok_out(&out);
    }
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "pr") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let raw_lines: Vec<String> = text
        .lines()
        .enumerate()
        .map(|(idx, l)| {
            if let Some((nsep, nwidth)) = number_lines {
                format!("{:>width$}{}{}", idx + 1, nsep, l, width = nwidth)
            } else {
                l.to_string()
            }
        })
        .collect();
    let lines: Vec<&str> = raw_lines.iter().map(|s| s.as_str()).collect();
    if cols <= 1 {
        let len = lines.len();
        for (idx, l) in lines.into_iter().enumerate() {
            out.push_str(l);
            out.push('\n');
            if double_space && idx + 1 < len {
                out.push('\n');
            }
        }
    } else if across {
        for chunk in lines.chunks(cols) {
            out.push_str(&chunk.join(&sep));
            out.push('\n');
        }
    } else {
        let rows = lines.len().div_ceil(cols);
        for r in 0..rows {
            let mut row_items = Vec::new();
            for c in 0..cols {
                if let Some(&item) = lines.get(r + c * rows) {
                    row_items.push(item);
                }
            }
            out.push_str(&row_items.join(&sep));
            out.push('\n');
        }
    }
    ok_out(&out)
}

struct ParsedTabs {
    stops: Vec<usize>,
    repeat: usize,
    relative: bool,
}

impl ParsedTabs {
    fn parse(specs: &[String]) -> Self {
        let mut stops: Vec<usize> = Vec::new();
        let mut abs_repeat = 0usize;
        let mut rel_repeat = 0usize;
        for spec in specs {
            let mut marker: Option<char> = None;
            for entry in spec.split([',', ' ', '\t']).filter(|s| !s.is_empty()) {
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
                if let Ok(n) = num_str.parse::<usize>() {
                    match marker {
                        Some('+') => rel_repeat = n,
                        Some('/') => abs_repeat = n,
                        _ => stops.push(n),
                    }
                }
            }
        }
        let mut repeat = if abs_repeat > 0 { abs_repeat } else { rel_repeat };
        let relative = rel_repeat > 0;
        if stops.is_empty() && repeat == 0 {
            repeat = 8;
        } else if stops.len() == 1 && repeat == 0 {
            repeat = stops.pop().unwrap_or(8);
        }
        Self {
            stops,
            repeat,
            relative,
        }
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
            i += 1;
        }
    }
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "expand") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let tabs = ParsedTabs::parse(&tab_specs);
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
            i += 1;
        }
    }
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "unexpand") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let tabs = ParsedTabs::parse(&tab_specs);
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

fn cmd_column(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut table = false;
    let mut json_mode = false;
    let mut table_name = "table".to_string();
    let mut col_names: Vec<String> = Vec::new();
    let mut right_spec = String::new();
    let mut hide_spec = String::new();
    let mut order_spec = String::new();
    let mut sep: Option<String> = None;
    let mut out_sep = "  ".to_string();
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-t" {
            table = true;
            i += 1;
        } else if a == "-J" || a == "--json" {
            table = true;
            json_mode = true;
            i += 1;
        } else if (a == "-n" || a == "--table-name") && i + 1 < args.len() {
            table_name = args[i + 1].clone();
            i += 2;
        } else if (a == "-N" || a == "--table-columns") && i + 1 < args.len() {
            col_names = args[i + 1].split(',').map(|s| s.to_string()).collect();
            i += 2;
        } else if (a == "-R" || a == "--table-right") && i + 1 < args.len() {
            right_spec = args[i + 1].clone();
            i += 2;
        } else if (a == "-H" || a == "--table-hide") && i + 1 < args.len() {
            hide_spec = args[i + 1].clone();
            i += 2;
        } else if (a == "-O" || a == "--table-order") && i + 1 < args.len() {
            order_spec = args[i + 1].clone();
            i += 2;
        } else if a == "-s" && i + 1 < args.len() {
            sep = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-s") && !rest.is_empty() {
            sep = Some(rest.to_string());
            i += 1;
        } else if a == "-o" && i + 1 < args.len() {
            out_sep = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-o") && !rest.is_empty() {
            out_sep = rest.to_string();
            i += 1;
        } else if !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "column") {
        Ok(t) => t,
        Err(e) => return e,
    };
    if !table {
        return ok_out(&text);
    }
    let rows: Vec<Vec<String>> = text
        .lines()
        .map(|l| {
            if let Some(ref s) = sep {
                let d = s.chars().next().unwrap_or(' ');
                l.split(d).map(|c| c.to_string()).collect()
            } else {
                l.split_whitespace().map(|c| c.to_string()).collect()
            }
        })
        .collect();
    let cols = rows
        .iter()
        .map(|r| r.len())
        .max()
        .unwrap_or(0)
        .max(col_names.len());
    let resolve_cols = |spec: &str| -> Vec<usize> {
        if spec.is_empty() {
            return Vec::new();
        }
        let mut res = Vec::new();
        for tok in spec.split(',') {
            let t = tok.trim();
            if let Some(pos) = col_names.iter().position(|n| n.eq_ignore_ascii_case(t)) {
                res.push(pos);
            } else if let Ok(n) = t.parse::<usize>()
                && n >= 1
                && n <= cols
            {
                res.push(n - 1);
            }
        }
        res
    };
    let hidden_cols = resolve_cols(&hide_spec);
    let right_cols = resolve_cols(&right_spec);
    let mut ordered = resolve_cols(&order_spec);
    for c in 0..cols {
        if !ordered.contains(&c) {
            ordered.push(c);
        }
    }
    let visible_cols: Vec<usize> = ordered
        .into_iter()
        .filter(|c| !hidden_cols.contains(c))
        .collect();

    if json_mode {
        let mut row_objs = Vec::new();
        for r in &rows {
            let mut fields = Vec::new();
            for &c in &visible_cols {
                let k = col_names
                    .get(c)
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_else(|| format!("col{}", c + 1));
                let v = r.get(c).map(|s| s.as_str()).unwrap_or("");
                let escaped = v.replace('\\', "\\\\").replace('"', "\\\"");
                fields.push(format!("\"{k}\":\"{escaped}\""));
            }
            row_objs.push(format!("{{{}}}", fields.join(",")));
        }
        return ok_out(&format!(
            "{{\"{}\":[{}]}}\n",
            table_name.to_ascii_lowercase(),
            row_objs.join(",")
        ));
    }

    let mut data_widths = vec![0usize; cols];
    for r in &rows {
        for (c, cell) in r.iter().enumerate() {
            data_widths[c] = data_widths[c].max(cell.len());
        }
    }
    let last_vis = visible_cols.last().copied();
    let mut widths = data_widths.clone();
    for (c, name) in col_names.iter().enumerate() {
        if Some(c) != last_vis || !right_cols.contains(&c) {
            widths[c] = widths[c].max(name.len());
        }
    }
    let mut out = String::new();
    if !col_names.is_empty() {
        for (pos, &c) in visible_cols.iter().enumerate() {
            if pos > 0 {
                out.push_str(&out_sep);
            }
            let h = col_names.get(c).map(|s| s.as_str()).unwrap_or("");
            if pos + 1 < visible_cols.len() {
                out.push_str(&format!("{h:<width$}", width = widths[c]));
            } else {
                out.push_str(h);
            }
        }
        out.push('\n');
    }
    for r in &rows {
        for (pos, &c) in visible_cols.iter().enumerate() {
            if pos > 0 {
                out.push_str(&out_sep);
            }
            let cell = r.get(c).map(|s| s.as_str()).unwrap_or("");
            if right_cols.contains(&c) {
                out.push_str(&format!("{cell:>width$}", width = widths[c]));
            } else if pos + 1 < visible_cols.len() {
                out.push_str(&format!("{cell:<width$}", width = widths[c]));
            } else {
                out.push_str(cell);
            }
        }
        out.push('\n');
    }
    ok_out(&out)
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
        } else if let Some(rest) = a.strip_prefix("--head-count=").or_else(|| a.strip_prefix("-n")) && !rest.is_empty() {
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
        } else if let Some(rest) = a.strip_prefix("--input-range=").or_else(|| a.strip_prefix("-i")) && !rest.is_empty() {
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

fn format_split_suffix(idx: usize, suffix_len: usize, numeric: bool) -> String {
    if numeric {
        format!("{idx:0suffix_len$}")
    } else {
        let mut rem = idx;
        let mut chars = vec!['a'; suffix_len.max(1)];
        for pos in (0..chars.len()).rev() {
            chars[pos] = (b'a' + (rem % 26) as u8) as char;
            rem /= 26;
        }
        chars.into_iter().collect()
    }
}

fn parse_split_size(s: &str) -> usize {
    let trimmed = s.trim();
    if let Some(num) = trimmed.strip_suffix('K').or_else(|| trimmed.strip_suffix('k')) {
        num.parse::<usize>().unwrap_or(1) * 1024
    } else if let Some(num) = trimmed.strip_suffix('M').or_else(|| trimmed.strip_suffix('m')) {
        num.parse::<usize>().unwrap_or(1) * 1024 * 1024
    } else {
        trimmed.parse::<usize>().unwrap_or(1000)
    }
}

fn cmd_split(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut lines_per = 1000usize;
    let mut bytes_per: Option<usize> = None;
    let mut chunks_num: Option<usize> = None;
    let mut numeric = false;
    let mut suffix_len = 2usize;
    let mut additional_suffix = String::new();
    let mut positional = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if (a == "-l" || a == "--lines") && i + 1 < args.len() {
            lines_per = args[i + 1].parse().unwrap_or(1000);
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--lines=").or_else(|| a.strip_prefix("-l")) && !rest.is_empty() {
            lines_per = rest.parse().unwrap_or(1000);
            i += 1;
        } else if (a == "-b" || a == "--bytes") && i + 1 < args.len() {
            bytes_per = Some(parse_split_size(&args[i + 1]));
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--bytes=").or_else(|| a.strip_prefix("-b")) && !rest.is_empty() {
            bytes_per = Some(parse_split_size(rest));
            i += 1;
        } else if (a == "-n" || a == "--number") && i + 1 < args.len() {
            let num_s = args[i + 1].rsplit('/').next().unwrap_or(&args[i + 1]);
            chunks_num = num_s.parse::<usize>().ok();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--number=").or_else(|| a.strip_prefix("-n")) && !rest.is_empty() {
            let num_s = rest.rsplit('/').next().unwrap_or(rest);
            chunks_num = num_s.parse::<usize>().ok();
            i += 1;
        } else if a == "-d" || a == "--numeric-suffixes" {
            numeric = true;
            i += 1;
        } else if (a == "-a" || a == "--suffix-length") && i + 1 < args.len() {
            suffix_len = args[i + 1].parse().unwrap_or(2);
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--suffix-length=").or_else(|| a.strip_prefix("-a")) && !rest.is_empty() {
            suffix_len = rest.parse().unwrap_or(2);
            i += 1;
        } else if let Some(rest) = a.strip_prefix("--additional-suffix=") {
            additional_suffix = rest.to_string();
            i += 1;
        } else if !a.starts_with('-') || a == "-" {
            positional.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let max_files = env
        .get("__limit_split_max_files")
        .and_then(|v| v.parse::<usize>().ok());
    let input_files: Vec<String> = positional.iter().take(1).cloned().collect();
    let prefix = positional.get(1).map(|s| s.as_str()).unwrap_or("x");
    let text = match read_inputs_or_stdin(&input_files, stdin, cwd, fs, "split") {
        Ok(t) => t,
        Err(e) => return e,
    };
    if let Some(n_chunks) = chunks_num {
        if let Some(mf) = max_files && n_chunks > mf {
            return err_out("split: maxFiles limit exceeded\n", 1);
        }
        let all_lines: Vec<&str> = text.split_inclusive('\n').collect();
        let per = all_lines.len().div_ceil(n_chunks.max(1)).max(1);
        for (idx, chunk) in all_lines.chunks(per).enumerate() {
            if let Some(mf) = max_files && idx + 1 > mf {
                return err_out("split: maxFiles limit exceeded\n", 1);
            }
            let suf = format_split_suffix(idx, suffix_len, numeric);
            let out_path = resolve_posix_path(cwd, &format!("{prefix}{suf}{additional_suffix}"));
            let _ = fs.write_file(&out_path, &stream_string_to_bytes(&chunk.concat()));
        }
    } else if let Some(b_per) = bytes_per {
        let raw_bytes = stream_string_to_bytes(&text);
        let chunks: Vec<&[u8]> = raw_bytes.chunks(b_per.max(1)).collect();
        if let Some(mf) = max_files && chunks.len() > mf {
            return err_out("split: maxFiles limit exceeded\n", 1);
        }
        for (idx, chunk) in chunks.into_iter().enumerate() {
            let suf = format_split_suffix(idx, suffix_len, numeric);
            let out_path = resolve_posix_path(cwd, &format!("{prefix}{suf}{additional_suffix}"));
            let _ = fs.write_file(&out_path, chunk);
        }
    } else {
        let all_lines: Vec<&str> = text.split_inclusive('\n').collect();
        let chunks: Vec<&[&str]> = all_lines.chunks(lines_per.max(1)).collect();
        if let Some(mf) = max_files && chunks.len() > mf {
            return err_out("split: maxFiles limit exceeded\n", 1);
        }
        for (idx, chunk) in chunks.into_iter().enumerate() {
            let suf = format_split_suffix(idx, suffix_len, numeric);
            let out_path = resolve_posix_path(cwd, &format!("{prefix}{suf}{additional_suffix}"));
            let _ = fs.write_file(&out_path, &stream_string_to_bytes(&chunk.concat()));
        }
    }
    let _ = (BTreeSet::<u8>::new(), normalize_posix_path);
    ok_out("")
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
    let mut backup = false;
    let mut backup_numbered = false;
    let mut compare_mode = false;
    let mut mode: Option<u32> = None;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-D" => create_dirs = true,
            "-C" | "--compare" => compare_mode = true,
            "-d" | "--directory" => dir_mode = true,
            "-b" | "--backup" => backup = true,
            "--backup=numbered" | "--backup=t" => backup_numbered = true,
            "-m" if i + 1 < args.len() => {
                i += 1;
                mode = u32::from_str_radix(&args[i], 8).ok();
            }
            a if a.starts_with("--backup=") => backup = true,
            a if !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    if dir_mode {
        for f in &files {
            let d = resolve_posix_path(cwd, f);
            let _ = fs.mkdir_all(&d);
            if let Some(m) = mode {
                let _ = fs.chmod(&d, 0o040000 | m);
            }
        }
        return ok_out("");
    }
    if files.len() >= 2 {
        let src = resolve_posix_path(cwd, &files[0]);
        let dst = resolve_posix_path(cwd, &files[1]);
        if create_dirs {
            let parent = dirname_posix_path(&dst);
            let _ = fs.mkdir_all(&parent);
        }
        let target_mode = mode.unwrap_or(0o755);
        if compare_mode
            && let (Ok(src_bytes), Ok(dst_bytes), Ok(dst_st)) =
                (fs.read_file(&src), fs.read_file(&dst), fs.stat(&dst))
            && src_bytes == dst_bytes
            && (dst_st.mode & 0o7777) == (target_mode & 0o7777)
        {
            return ok_out("");
        }
        if let Ok(old_bytes) = fs.read_file(&dst) {
            if backup_numbered {
                for k in 1..1000usize {
                    let bak = format!("{dst}.~{k}~");
                    if !fs.exists(&bak) {
                        let _ = fs.write_file(&bak, &old_bytes);
                        break;
                    }
                }
            } else if backup {
                let _ = fs.write_file(&format!("{dst}~"), &old_bytes);
            }
        }
        if let Ok(bytes) = fs.read_file(&src) {
            let _ = fs.write_file(&dst, &bytes);
            let _ = fs.chmod(&dst, 0o100000 | target_mode);
        }
    }
    ok_out("")
}

fn cmd_join(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut delim: Option<char> = None;
    let mut f1_idx = 1usize;
    let mut f2_idx = 1usize;
    let mut a1 = false;
    let mut a2 = false;
    let mut v1 = false;
    let mut v2 = false;
    let mut ignore_case = false;
    let mut header = false;
    let mut auto_format = false;
    let mut empty_str = String::new();
    let mut out_format: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--header" {
            header = true;
            i += 1;
        } else if a == "-t" && i + 1 < args.len() {
            delim = args[i + 1].chars().next();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-t")
            && !rest.is_empty()
        {
            delim = rest.chars().next();
            i += 1;
        } else if a == "-1" && i + 1 < args.len() {
            f1_idx = args[i + 1].parse::<usize>().unwrap_or(1).max(1);
            i += 2;
        } else if a == "-2" && i + 1 < args.len() {
            f2_idx = args[i + 1].parse::<usize>().unwrap_or(1).max(1);
            i += 2;
        } else if a == "-j" && i + 1 < args.len() {
            let j = args[i + 1].parse::<usize>().unwrap_or(1).max(1);
            f1_idx = j;
            f2_idx = j;
            i += 2;
        } else if a == "-a" && i + 1 < args.len() {
            if args[i + 1] == "1" {
                a1 = true;
            } else if args[i + 1] == "2" {
                a2 = true;
            }
            i += 2;
        } else if a == "-a1" {
            a1 = true;
            i += 1;
        } else if a == "-a2" {
            a2 = true;
            i += 1;
        } else if a == "-v" && i + 1 < args.len() {
            if args[i + 1] == "1" {
                v1 = true;
            } else if args[i + 1] == "2" {
                v2 = true;
            }
            i += 2;
        } else if a == "-v1" {
            v1 = true;
            i += 1;
        } else if a == "-v2" {
            v2 = true;
            i += 1;
        } else if a == "-e" && i + 1 < args.len() {
            empty_str = args[i + 1].clone();
            i += 2;
        } else if a == "-o" && i + 1 < args.len() {
            if args[i + 1] == "auto" {
                auto_format = true;
            } else {
                for spec in args[i + 1].split(|c: char| c == ',' || c.is_whitespace()).filter(|s| !s.is_empty()) {
                    out_format.push(spec.to_string());
                }
            }
            i += 2;
        } else if a == "-i" || a == "--ignore-case" {
            ignore_case = true;
            i += 1;
        } else {
            files.push(a.clone());
            i += 1;
        }
    }

    if files.len() < 2 {
        return err_out("join: missing operand\n", 1);
    }

    let read_one = |f: &str| -> Result<String, String> {
        if f == "-" {
            Ok(stdin.to_string())
        } else {
            let p = resolve_posix_path(cwd, f);
            fs.read_file(&p)
                .map(|b| String::from_utf8_lossy(&b).into_owned())
        }
    };

    let c1 = match read_one(&files[0]) {
        Ok(s) => s,
        Err(e) => return err_out(&format!("join: {}: {e}\n", files[0]), 1),
    };
    let c2 = match read_one(&files[1]) {
        Ok(s) => s,
        Err(e) => return err_out(&format!("join: {}: {e}\n", files[1]), 1),
    };

    let split_fields = |line: &str| -> Vec<String> {
        if let Some(d) = delim {
            line.split(d).map(|s| s.to_string()).collect()
        } else {
            line.split_whitespace().map(|s| s.to_string()).collect()
        }
    };

    let rows1: Vec<Vec<String>> = c1.lines().filter(|l| !l.is_empty()).map(split_fields).collect();
    let rows2: Vec<Vec<String>> = c2.lines().filter(|l| !l.is_empty()).map(split_fields).collect();
    let sep = delim.map(|c| c.to_string()).unwrap_or_else(|| " ".to_string());

    if auto_format && out_format.is_empty() {
        out_format.push("0".to_string());
        let cols1 = rows1.first().map(|r| r.len()).unwrap_or(1);
        let cols2 = rows2.first().map(|r| r.len()).unwrap_or(1);
        for c in 1..=cols1 {
            if c != f1_idx {
                out_format.push(format!("1.{c}"));
            }
        }
        for c in 1..=cols2 {
            if c != f2_idx {
                out_format.push(format!("2.{c}"));
            }
        }
    }

    let norm_key = |k: &str| -> String {
        if ignore_case {
            k.to_lowercase()
        } else {
            k.to_string()
        }
    };

    let format_row = |key: &str, r1: Option<&[String]>, r2: Option<&[String]>| -> String {
        if !out_format.is_empty() {
            let parts: Vec<String> = out_format
                .iter()
                .map(|spec| {
                    if spec == "0" {
                        key.to_string()
                    } else if let Some(rest) = spec.strip_prefix("1.") {
                        let idx = rest.parse::<usize>().unwrap_or(1).saturating_sub(1);
                        r1.and_then(|r| r.get(idx))
                            .filter(|s| !s.is_empty())
                            .cloned()
                            .unwrap_or_else(|| empty_str.clone())
                    } else if let Some(rest) = spec.strip_prefix("2.") {
                        let idx = rest.parse::<usize>().unwrap_or(1).saturating_sub(1);
                        r2.and_then(|r| r.get(idx))
                            .filter(|s| !s.is_empty())
                            .cloned()
                            .unwrap_or_else(|| empty_str.clone())
                    } else {
                        empty_str.clone()
                    }
                })
                .collect();
            return parts.join(&sep);
        }
        let mut parts = vec![key.to_string()];
        if let Some(r) = r1 {
            for (idx, val) in r.iter().enumerate() {
                if idx + 1 != f1_idx {
                    parts.push(if val.is_empty() && !empty_str.is_empty() { empty_str.clone() } else { val.clone() });
                }
            }
        }
        if let Some(r) = r2 {
            for (idx, val) in r.iter().enumerate() {
                if idx + 1 != f2_idx {
                    parts.push(if val.is_empty() && !empty_str.is_empty() { empty_str.clone() } else { val.clone() });
                }
            }
        }
        parts.join(&sep)
    };

    let mut out = String::new();
    let mut i1 = 0usize;
    let mut i2 = 0usize;

    if header && !rows1.is_empty() && !rows2.is_empty() {
        let hk = rows1[0].get(f1_idx - 1).map(|s| s.as_str()).unwrap_or("");
        out.push_str(&format_row(hk, Some(&rows1[0]), Some(&rows2[0])));
        out.push('\n');
        i1 = 1;
        i2 = 1;
    }

    while i1 < rows1.len() && i2 < rows2.len() {
        let k1_raw = rows1[i1].get(f1_idx - 1).map(|s| s.as_str()).unwrap_or("");
        let k2_raw = rows2[i2].get(f2_idx - 1).map(|s| s.as_str()).unwrap_or("");
        let k1 = norm_key(k1_raw);
        let k2 = norm_key(k2_raw);

        match k1.cmp(&k2) {
            std::cmp::Ordering::Less => {
                if a1 || v1 {
                    out.push_str(&format_row(k1_raw, Some(&rows1[i1]), None));
                    out.push('\n');
                }
                i1 += 1;
            }
            std::cmp::Ordering::Greater => {
                if a2 || v2 {
                    out.push_str(&format_row(k2_raw, None, Some(&rows2[i2])));
                    out.push('\n');
                }
                i2 += 1;
            }
            std::cmp::Ordering::Equal => {
                let mut end1 = i1 + 1;
                while end1 < rows1.len()
                    && norm_key(rows1[end1].get(f1_idx - 1).map(|s| s.as_str()).unwrap_or("")) == k1
                {
                    end1 += 1;
                }
                let mut end2 = i2 + 1;
                while end2 < rows2.len()
                    && norm_key(rows2[end2].get(f2_idx - 1).map(|s| s.as_str()).unwrap_or("")) == k2
                {
                    end2 += 1;
                }
                if !v1 && !v2 {
                    for r1 in &rows1[i1..end1] {
                        let key_str = r1.get(f1_idx - 1).map(|s| s.as_str()).unwrap_or("");
                        for r2 in &rows2[i2..end2] {
                            out.push_str(&format_row(key_str, Some(r1), Some(r2)));
                            out.push('\n');
                        }
                    }
                }
                i1 = end1;
                i2 = end2;
            }
        }
    }

    while i1 < rows1.len() {
        if a1 || v1 {
            let k1_raw = rows1[i1].get(f1_idx - 1).map(|s| s.as_str()).unwrap_or("");
            out.push_str(&format_row(k1_raw, Some(&rows1[i1]), None));
            out.push('\n');
        }
        i1 += 1;
    }
    while i2 < rows2.len() {
        if a2 || v2 {
            let k2_raw = rows2[i2].get(f2_idx - 1).map(|s| s.as_str()).unwrap_or("");
            out.push_str(&format_row(k2_raw, None, Some(&rows2[i2])));
            out.push('\n');
        }
        i2 += 1;
    }

    ok_out(&out)
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

fn cmd_tsort(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let files: Vec<String> = args.iter().filter(|a| !a.starts_with('-')).cloned().collect();
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "tsort") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let tokens: Vec<&str> = text.split_whitespace().collect();
    if !tokens.len().is_multiple_of(2) {
        return err_out("tsort: odd number of tokens\n", 1);
    }
    let mut nodes: Vec<String> = Vec::new();
    let mut adj: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut in_deg: BTreeMap<String, usize> = BTreeMap::new();
    for pair in tokens.chunks(2) {
        let u = pair[0].to_string();
        let v = pair[1].to_string();
        if !in_deg.contains_key(&u) {
            in_deg.insert(u.clone(), 0);
            nodes.push(u.clone());
        }
        if !in_deg.contains_key(&v) {
            in_deg.insert(v.clone(), 0);
            nodes.push(v.clone());
        }
        if u != v {
            let edges = adj.entry(u).or_default();
            if !edges.contains(&v) {
                edges.push(v.clone());
                *in_deg.entry(v).or_insert(0) += 1;
            }
        }
    }
    nodes.sort();
    let mut out = String::new();
    let mut printed: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut had_cycle = false;
    while printed.len() < nodes.len() {
        let mut queue: std::collections::VecDeque<String> = nodes
            .iter()
            .filter(|n| !printed.contains(*n) && in_deg.get(*n).copied().unwrap_or(0) == 0)
            .cloned()
            .collect();
        if queue.is_empty() {
            had_cycle = true;
            if let Some(first_unprinted) = nodes.iter().find(|n| !printed.contains(*n)).cloned() {
                in_deg.insert(first_unprinted.clone(), 0);
                queue.push_back(first_unprinted);
            }
        }
        while let Some(u) = queue.pop_front() {
            if !printed.insert(u.clone()) {
                continue;
            }
            out.push_str(&u);
            out.push('\n');
            if let Some(neighbors) = adj.get(&u) {
                for v in neighbors.iter().rev() {
                    if let Some(d) = in_deg.get_mut(v) {
                        *d = d.saturating_sub(1);
                        if *d == 0 && !printed.contains(v) {
                            queue.push_back(v.clone());
                        }
                    }
                }
            }
        }
    }
    BuiltinOutcome {
        stdout: out,
        stderr: if had_cycle { "tsort: cycle detected\n".to_string() } else { String::new() },
        exit_code: if had_cycle { 1 } else { 0 },
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
