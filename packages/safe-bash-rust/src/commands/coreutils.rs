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
        "wc" => Some(cmd_wc(args, stdin, cwd, fs)),
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
        "tee" => Some(cmd_tee(args, stdin, cwd, fs)),
        "sponge" => Some(cmd_sponge(args, stdin, cwd, fs)),
        "seq" => Some(cmd_seq(args)),
        "yes" => Some(cmd_yes(args)),
        "basename" => Some(cmd_basename(args)),
        "dirname" => Some(cmd_dirname(args)),
        "env" | "printenv" => Some(cmd_printenv(args, env)),
        "envsubst" => Some(cmd_envsubst(stdin, env)),
        "expr" => Some(cmd_expr(args)),
        "bc" => Some(cmd_bc(args, stdin, cwd, fs)),
        "numfmt" => Some(cmd_numfmt(args, stdin)),
        "uname" => Some(cmd_uname(args)),
        "whoami" => Some(ok_out(&format!(
            "{}\n",
            env.get("USER").map(|s| s.as_str()).unwrap_or("root")
        ))),
        "hostname" => Some(ok_out("safe-bash\n")),
        "nproc" => Some(ok_out("4\n")),
        "id" => Some(cmd_id(args, env)),
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
        "split" => Some(cmd_split(args, stdin, cwd, fs)),
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
        let bytes = text.as_bytes();
        let slice = if from_start {
            let start = bc.saturating_sub(1).min(bytes.len());
            &bytes[start..]
        } else {
            let start = bytes.len().saturating_sub(bc);
            &bytes[start..]
        };
        return ok_out(&String::from_utf8_lossy(slice));
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

fn cmd_wc(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut show_l = false;
    let mut show_w = false;
    let mut show_c = false;
    let mut show_m = false;
    let mut show_max_l = false;
    let mut files = Vec::new();

    for a in args {
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

    let count_one = |s: &str| -> (usize, usize, usize, usize, usize) {
        let l = s.bytes().filter(|&b| b == b'\n').count();
        let w = s.split_whitespace().count();
        let c = stream_string_to_bytes(s).len();
        let m = s.chars().count();
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
        numeric: bool,
        human: bool,
        version: bool,
        month: bool,
        reverse: bool,
        ignore_case: bool,
        ignore_blanks: bool,
    }
    let mut reverse = false;
    let mut numeric = false;
    let mut human = false;
    let mut version = false;
    let mut month = false;
    let mut unique = false;
    let mut ignore_case = false;
    let mut ignore_blanks = false;
    let mut check_only = false;
    let mut zero_term = false;
    let mut sep: Option<char> = None;
    let mut keys: Vec<SortKeySpec> = Vec::new();
    let mut files = Vec::new();
    let mut i = 0usize;

    let parse_k = |spec: &str, def_n: bool, def_h: bool, def_v: bool, def_m: bool, def_r: bool, def_f: bool, def_b: bool| -> Option<SortKeySpec> {
        let col_s: String = spec.chars().take_while(|c| c.is_ascii_digit()).collect();
        let col = col_s.parse::<usize>().ok()?;
        let has_mods = spec.chars().any(|c| matches!(c, 'n' | 'h' | 'V' | 'M' | 'r' | 'f' | 'b'));
        Some(SortKeySpec {
            col,
            numeric: if has_mods { spec.contains('n') } else { def_n },
            human: if has_mods { spec.contains('h') } else { def_h },
            version: if has_mods { spec.contains('V') } else { def_v },
            month: if has_mods { spec.contains('M') } else { def_m },
            reverse: if has_mods { spec.contains('r') } else { def_r },
            ignore_case: if has_mods { spec.contains('f') } else { def_f },
            ignore_blanks: if has_mods { spec.contains('b') } else { def_b },
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
        } else if a == "-k" && i + 1 < args.len() {
            if let Some(k) = parse_k(&args[i + 1], numeric, human, version, month, reverse, ignore_case, ignore_blanks) {
                keys.push(k);
            }
            i += 2;
        } else if let Some(spec) = a.strip_prefix("-k")
            && !spec.is_empty()
        {
            if let Some(k) = parse_k(spec, numeric, human, version, month, reverse, ignore_case, ignore_blanks) {
                keys.push(k);
            }
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'r' => reverse = true,
                    'n' => numeric = true,
                    'h' => human = true,
                    'V' => version = true,
                    'M' => month = true,
                    'u' => unique = true,
                    'f' => ignore_case = true,
                    'b' => ignore_blanks = true,
                    'c' | 'C' => check_only = true,
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

    let extract_col = |line: &str, col: usize, ic: bool, ib: bool| -> String {
        let field = if col >= 1 {
            if let Some(d) = sep {
                line.split(d).nth(col - 1).unwrap_or("")
            } else {
                line.split_whitespace().nth(col - 1).unwrap_or("")
            }
        } else {
            line
        };
        let f_trimmed = if ib { field.trim_start() } else { field };
        if ic {
            f_trimmed.to_lowercase()
        } else {
            f_trimmed.to_string()
        }
    };

    let cmp_keys_only = |a: &str, b: &str| -> std::cmp::Ordering {
        for k in &keys {
            let ka = extract_col(a, k.col, k.ignore_case, k.ignore_blanks);
            let kb = extract_col(b, k.col, k.ignore_case, k.ignore_blanks);
            let c = if k.human {
                parse_human_sort_val(&ka)
                    .partial_cmp(&parse_human_sort_val(&kb))
                    .unwrap_or(std::cmp::Ordering::Equal)
            } else if k.version {
                compare_version_str(&ka, &kb)
            } else if k.month {
                parse_month_sort_val(&ka).cmp(&parse_month_sort_val(&kb))
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
        let a_base = if ignore_blanks { a.trim_start() } else { a };
        let b_base = if ignore_blanks { b.trim_start() } else { b };
        let ka = if ignore_case { a_base.to_lowercase() } else { a_base.to_string() };
        let kb = if ignore_case { b_base.to_lowercase() } else { b_base.to_string() };
        let cmp = if human && keys.is_empty() {
            parse_human_sort_val(&ka)
                .partial_cmp(&parse_human_sort_val(&kb))
                .unwrap_or(std::cmp::Ordering::Equal)
        } else if version && keys.is_empty() {
            compare_version_str(&ka, &kb)
        } else if month && keys.is_empty() {
            parse_month_sort_val(&ka).cmp(&parse_month_sort_val(&kb))
        } else if numeric && keys.is_empty() {
            let na = parse_leading_f64(&ka);
            let nb = parse_leading_f64(&kb);
            na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
        } else {
            ka.cmp(&kb)
        };
        if reverse && keys.is_empty() { cmp.reverse() } else { cmp }
    };

    if check_only {
        for idx in 1..lines.len() {
            let ord = cmp_keys_only(lines[idx - 1], lines[idx]);
            if ord == std::cmp::Ordering::Greater || (unique && ord == std::cmp::Ordering::Equal) {
                return err_out("sort: disorder\n", 1);
            }
        }
        return ok_out("");
    }

    lines.sort_by(|a, b| cmp_keys_only(a, b).then_with(|| if reverse && keys.is_empty() { b.cmp(a) } else { a.cmp(b) }));

    if unique {
        lines.dedup_by(|a, b| cmp_keys_only(b, a) == std::cmp::Ordering::Equal);
    }

    let term = if zero_term { '\0' } else { '\n' };
    let sep_s = if zero_term { "\0" } else { "\n" };
    let mut out = lines.join(sep_s);
    out.push(term);
    ok_out(&out)
}

fn uniq_compare_slice(line: &str, skip_fields: usize, skip_chars: usize, max_chars: Option<usize>) -> String {
    let mut s = line;
    for _ in 0..skip_fields {
        s = s.trim_start_matches([' ', '\t']);
        s = s.trim_start_matches(|c: char| c != ' ' && c != '\t');
    }
    if skip_fields > 0 {
        s = s.trim_start_matches([' ', '\t']);
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
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                match chars[ci] {
                    'c' => count = true,
                    'd' => repeated_only = true,
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

    let mut groups: Vec<(&str, usize)> = Vec::new();
    for line in text.lines() {
        if let Some(last) = groups.last_mut() {
            let k1 = uniq_compare_slice(last.0, skip_fields, skip_chars, max_chars);
            let k2 = uniq_compare_slice(line, skip_fields, skip_chars, max_chars);
            let same = if ignore_case {
                k1.eq_ignore_ascii_case(&k2)
            } else {
                k1 == k2
            };
            if same {
                last.1 += 1;
                continue;
            }
        }
        groups.push((line, 1));
    }

    let mut out = String::new();
    for (line, n) in groups {
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

    let join_sep = out_delim.unwrap_or_else(|| delim.to_string());
    let mut out = String::new();
    for line in text.lines() {
        if !chars_spec.is_empty() {
            let chs: Vec<char> = line.chars().collect();
            let idxs = parse_ranges(&chars_spec, chs.len(), complement);
            for idx in idxs {
                if let Some(&c) = chs.get(idx) {
                    out.push(c);
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
    let mut sets = Vec::new();
    for a in args {
        if a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'd' => delete = true,
                    's' => squeeze = true,
                    'c' | 'C' => complement = true,
                    _ => {}
                }
            }
        } else {
            sets.push(a.clone());
        }
    }
    let set1 = sets.first().map(|s| expand_tr_set(s)).unwrap_or_default();
    let set2 = sets.get(1).map(|s| expand_tr_set(s)).unwrap_or_default();

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
    let text = match read_inputs_or_stdin(args, stdin, cwd, fs, "tac") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let mut lines: Vec<&str> = text.lines().collect();
    lines.reverse();
    if lines.is_empty() {
        ok_out("")
    } else {
        ok_out(&format!("{}\n", lines.join("\n")))
    }
}

fn cmd_rev(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let text = match read_inputs_or_stdin(args, stdin, cwd, fs, "rev") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let mut out = String::new();
    for line in text.lines() {
        let rev: String = line.chars().rev().collect();
        out.push_str(&rev);
        out.push('\n');
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
    let d_chars: Vec<char> = if delim.is_empty() {
        vec!['\t']
    } else {
        delim.chars().collect()
    };
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
                if idx > 0 {
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
                if col > 0 {
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
    let mut files = Vec::new();
    for a in args {
        if a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    '1' => s1 = true,
                    '2' => s2 = true,
                    '3' => s3 = true,
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
    let read_one = |f: &str| -> Result<Vec<String>, String> {
        if f == "-" {
            return Ok(stdin.lines().map(|s| s.to_string()).collect());
        }
        let b = fs.read_file(&resolve_posix_path(cwd, f))?;
        Ok(String::from_utf8_lossy(&b).lines().map(|s| s.to_string()).collect())
    };
    let Ok(l1) = read_one(&files[0]) else {
        return err_out("comm: read error\n", 1);
    };
    let Ok(l2) = read_one(&files[1]) else {
        return err_out("comm: read error\n", 1);
    };
    let mut i = 0usize;
    let mut j = 0usize;
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
                if !s1 {
                    out.push_str(&format!("{}\n", l1[i]));
                }
                i += 1;
            }
            std::cmp::Ordering::Greater => {
                if !s2 {
                    let prefix = if s1 { "" } else { "\t" };
                    out.push_str(&format!("{prefix}{}\n", l2[j]));
                }
                j += 1;
            }
            std::cmp::Ordering::Equal => {
                if !s3 {
                    let mut prefix = String::new();
                    if !s1 {
                        prefix.push('\t');
                    }
                    if !s2 {
                        prefix.push('\t');
                    }
                    out.push_str(&format!("{prefix}{}\n", l1[i]));
                }
                i += 1;
                j += 1;
            }
        }
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

fn cmd_seq(args: &[String]) -> BuiltinOutcome {
    let mut sep = "\n".to_string();
    let mut equal_width = false;
    let mut nums = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-s" && i + 1 < args.len() {
            sep = args[i + 1].clone();
            i += 2;
        } else if a == "-w" {
            equal_width = true;
            i += 1;
        } else {
            nums.push(a.clone());
            i += 1;
        }
    }
    let (first, step, last) = match nums.len() {
        1 => (1i64, 1i64, nums[0].parse::<i64>().unwrap_or(1)),
        2 => (
            nums[0].parse::<i64>().unwrap_or(1),
            1i64,
            nums[1].parse::<i64>().unwrap_or(1),
        ),
        3 => (
            nums[0].parse::<i64>().unwrap_or(1),
            nums[1].parse::<i64>().unwrap_or(1),
            nums[2].parse::<i64>().unwrap_or(1),
        ),
        _ => return ok_out(""),
    };
    if step == 0 {
        return err_out("seq: zero increment\n", 1);
    }
    let width = if equal_width {
        nums.iter().map(|s| s.len()).max().unwrap_or(1)
    } else {
        0
    };
    let mut items = Vec::new();
    let mut cur = first;
    while (step > 0 && cur <= last) || (step < 0 && cur >= last) {
        if equal_width {
            items.push(format!("{cur:0width$}"));
        } else {
            items.push(cur.to_string());
        }
        cur += step;
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
    let mut operands = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        if args[i] == "-s" && i + 1 < args.len() {
            suffix = Some(args[i + 1].clone());
            i += 2;
        } else if args[i] == "-a" {
            i += 1;
        } else {
            operands.push(args[i].clone());
            i += 1;
        }
    }
    let Some(path) = operands.first() else {
        return err_out("basename: missing operand\n", 1);
    };
    let suf = suffix.as_deref().or_else(|| operands.get(1).map(|s| s.as_str()));
    let mut base = basename_posix_path(path);
    if let Some(s) = suf
        && base.len() > s.len()
        && let Some(stripped) = base.strip_suffix(s)
    {
        base = stripped.to_string();
    }
    ok_out(&format!("{base}\n"))
}

fn cmd_dirname(args: &[String]) -> BuiltinOutcome {
    let Some(path) = args.first() else {
        return err_out("dirname: missing operand\n", 1);
    };
    ok_out(&format!("{}\n", dirname_posix_path(path)))
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

fn cmd_envsubst(stdin: &str, env: &BTreeMap<String, String>) -> BuiltinOutcome {
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
                if let Some(v) = env.get(&name) {
                    out.push_str(v);
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
                } else if let Some(v) = env.get(&name) {
                    out.push_str(v);
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
    if args.len() == 2 && args[0] == "length" {
        let len = args[1].chars().count();
        return BuiltinOutcome {
            stdout: format!("{len}\n"),
            stderr: String::new(),
            exit_code: if len == 0 { 1 } else { 0 },
        };
    }
    if args.len() == 4 && args[0] == "substr" {
        let s: Vec<char> = args[1].chars().collect();
        let pos = args[2].parse::<usize>().unwrap_or(0);
        let len = args[3].parse::<usize>().unwrap_or(0);
        let sub: String = if pos == 0 || len == 0 || pos > s.len() {
            String::new()
        } else {
            s[pos - 1..(pos - 1 + len).min(s.len())].iter().collect()
        };
        let empty = sub.is_empty();
        return BuiltinOutcome {
            stdout: format!("{sub}\n"),
            stderr: String::new(),
            exit_code: if empty { 1 } else { 0 },
        };
    }
    if args.len() == 3 && args[0] == "index" {
        let s = &args[1];
        let chars_set = &args[2];
        let mut found = 0usize;
        for (i, ch) in s.chars().enumerate() {
            if chars_set.contains(ch) {
                found = i + 1;
                break;
            }
        }
        return BuiltinOutcome {
            stdout: format!("{found}\n"),
            stderr: String::new(),
            exit_code: if found == 0 { 1 } else { 0 },
        };
    }
    if args.len() == 3 {
        let a = args[0].parse::<i64>().unwrap_or(0);
        let b = args[2].parse::<i64>().unwrap_or(0);
        let res = match args[1].as_str() {
            "+" => (a + b).to_string(),
            "-" => (a - b).to_string(),
            "*" => (a * b).to_string(),
            "/" => {
                if b == 0 {
                    return err_out("expr: division by zero\n", 2);
                }
                (a / b).to_string()
            }
            "%" => {
                if b == 0 {
                    return err_out("expr: division by zero\n", 2);
                }
                (a % b).to_string()
            }
            "=" | "==" => i32::from(args[0] == args[2]).to_string(),
            "!=" => i32::from(args[0] != args[2]).to_string(),
            "<" => i32::from(a < b).to_string(),
            "<=" => i32::from(a <= b).to_string(),
            ">" => i32::from(a > b).to_string(),
            ">=" => i32::from(a >= b).to_string(),
            _ => "0".to_string(),
        };
        let is_zero = res == "0" || res.is_empty();
        return BuiltinOutcome {
            stdout: format!("{res}\n"),
            stderr: String::new(),
            exit_code: if is_zero { 1 } else { 0 },
        };
    }
    ok_out(&format!("{}\n", args[0]))
}

fn cmd_bc(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut files = Vec::new();
    for a in args {
        if !a.starts_with('-') {
            files.push(a.clone());
        }
    }
    let input = match read_inputs_or_stdin(&files, stdin, cwd, fs, "bc") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let mut vars: BTreeMap<String, f64> = BTreeMap::new();
    let mut scale = 0usize;
    let mut out = String::new();

    for line in input.lines() {
        let clean = line.split('#').next().unwrap_or("").trim();
        for stmt in clean.split(';') {
            let s = stmt.trim();
            if s.is_empty() || s == "quit" {
                continue;
            }
            if let Some(rest) = s.strip_prefix("scale")
                && let Some(val_s) = rest.trim().strip_prefix('=')
            {
                scale = val_s.trim().parse().unwrap_or(0);
                continue;
            }
            if let Some((lhs, rhs)) = s.split_once('=')
                && !lhs.ends_with(['<', '>', '!', '='])
                && !rhs.starts_with('=')
            {
                let v = eval_bc_expr(rhs.trim(), &vars, scale);
                vars.insert(lhs.trim().to_string(), v);
                continue;
            }
            let val = eval_bc_expr(s, &vars, scale);
            if scale == 0 {
                out.push_str(&format!("{}\n", val.trunc() as i64));
            } else {
                out.push_str(&format!("{val:.scale$}\n"));
            }
        }
    }
    ok_out(&out)
}

fn eval_bc_expr(expr: &str, vars: &BTreeMap<String, f64>, scale: usize) -> f64 {
    let mut env_str: BTreeMap<String, String> = vars
        .iter()
        .map(|(k, v)| (k.clone(), (*v as i64).to_string()))
        .collect();
    if scale == 0
        && !expr.contains('.')
        && let Ok(iv) = crate::shell::expand::eval_arith(&expr.replace('^', "**"), &mut env_str)
    {
        return iv as f64;
    }
    // Floating point expression evaluation
    eval_float_expr(expr, vars, scale)
}

fn eval_float_expr(expr: &str, vars: &BTreeMap<String, f64>, scale: usize) -> f64 {
    let s = expr.trim();
    if let Some(inner) = s.strip_prefix('(').and_then(|r| r.strip_suffix(')'))
        && balanced_parens(inner)
    {
        return eval_float_expr(inner, vars, scale);
    }
    for op in ['+', '-'] {
        if let Some(idx) = rfind_top_level(s, op)
            && idx > 0
        {
            let l = eval_float_expr(&s[..idx], vars, scale);
            let r = eval_float_expr(&s[idx + 1..], vars, scale);
            return if op == '+' { l + r } else { l - r };
        }
    }
    for op in ['*', '/', '%'] {
        if let Some(idx) = rfind_top_level(s, op) {
            let l = eval_float_expr(&s[..idx], vars, scale);
            let r = eval_float_expr(&s[idx + 1..], vars, scale);
            return match op {
                '*' => l * r,
                '/' => {
                    if r == 0.0 {
                        0.0
                    } else if scale == 0 {
                        (l / r).trunc()
                    } else {
                        let factor = 10f64.powi(scale as i32);
                        ((l / r) * factor).trunc() / factor
                    }
                }
                '%' => (l as i64 % (r as i64).max(1)) as f64,
                _ => 0.0,
            };
        }
    }
    if let Some(idx) = rfind_top_level(s, '^') {
        let l = eval_float_expr(&s[..idx], vars, scale);
        let r = eval_float_expr(&s[idx + 1..], vars, scale);
        return l.powf(r);
    }
    if let Some(&v) = vars.get(s) {
        return v;
    }
    s.parse::<f64>().unwrap_or(0.0)
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
    let mut d = 0i32;
    let bytes = s.as_bytes();
    for i in (0..bytes.len()).rev() {
        match bytes[i] as char {
            ')' => d += 1,
            '(' => d -= 1,
            c if c == target && d == 0 => return Some(i),
            _ => {}
        }
    }
    None
}

fn cmd_numfmt(args: &[String], stdin: &str) -> BuiltinOutcome {
    let mut to_mode = String::new();
    let mut from_mode = String::new();
    let mut suffix = String::new();
    let mut delimiter: Option<String> = None;
    let mut header_lines = 0usize;
    let mut field_idx = 1usize;
    let mut operands = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if let Some(v) = a.strip_prefix("--to=") {
            to_mode = v.to_string();
        } else if let Some(v) = a.strip_prefix("--from=") {
            from_mode = v.to_string();
        } else if let Some(v) = a.strip_prefix("--suffix=") {
            suffix = v.to_string();
        } else if a == "--header" {
            header_lines = 1;
        } else if let Some(v) = a.strip_prefix("--header=") {
            header_lines = v.parse::<usize>().unwrap_or(1);
        } else if let Some(v) = a.strip_prefix("--field=") {
            field_idx = v.parse::<usize>().unwrap_or(1).max(1);
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

    let inputs: Vec<String> = if operands.is_empty() {
        stdin.lines().map(|l| l.to_string()).filter(|l| !l.is_empty()).collect()
    } else {
        operands
    };

    let units = ['K', 'M', 'G', 'T', 'P', 'E'];
    let fmt_val = |raw: &str| -> String {
        let mut val = parse_human_num(raw, &from_mode);
        if to_mode == "iec" || to_mode == "iec-i" || to_mode == "si" {
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
                let u = units[u_idx];
                if (val - val.round()).abs() < 1e-9 {
                    format!("{:.0}{u}{i_suf}{suffix}", val)
                } else {
                    format!("{val:.1}{u}{i_suf}{suffix}")
                }
            }
        } else {
            format!("{}{suffix}", val as i64)
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
            if field_idx >= 1 && field_idx <= parts.len() {
                parts[field_idx - 1] = fmt_val(&parts[field_idx - 1]);
            }
            parts.join(delim)
        } else {
            fmt_val(item.trim())
        };
        out.push_str(&formatted);
        out.push('\n');
    }
    ok_out(&out)
}

fn parse_human_num(s: &str, from_mode: &str) -> f64 {
    let trimmed = s.trim().trim_end_matches('i').trim_end_matches('B');
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

fn cmd_uname(args: &[String]) -> BuiltinOutcome {
    if args.iter().any(|a| a == "-a") {
        ok_out("Linux safe-bash 6.1.0 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux\n")
    } else if args.iter().any(|a| a == "-m") {
        ok_out("x86_64\n")
    } else if args.iter().any(|a| a == "-r") {
        ok_out("6.1.0\n")
    } else if args.iter().any(|a| a == "-n") {
        ok_out("safe-bash\n")
    } else {
        ok_out("Linux\n")
    }
}

fn cmd_id(args: &[String], env: &BTreeMap<String, String>) -> BuiltinOutcome {
    let user = env.get("USER").map(|s| s.as_str()).unwrap_or("e2e");
    if args.iter().any(|a| a == "-u") {
        ok_out("1000\n")
    } else if args.iter().any(|a| a == "-g") {
        ok_out("1000\n")
    } else if args.iter().any(|a| a == "-un" || a == "-nu") {
        ok_out(&format!("{user}\n"))
    } else {
        ok_out(&format!("uid=1000({user}) gid=1000({user}) groups=1000({user})\n"))
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
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if (a == "-w" || a == "--width") && i + 1 < args.len() {
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
        } else if a.starts_with('-') && a.len() > 1 && !a.starts_with("--") {
            for ch in a[1..].chars() {
                if ch == 's' {
                    break_spaces = true;
                }
            }
            i += 1;
        } else if !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "fold") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let mut out = String::new();
    let w = width.max(1);
    for line in text.lines() {
        let chs: Vec<char> = line.chars().collect();
        if chs.is_empty() {
            out.push('\n');
        } else if !break_spaces {
            for chunk in chs.chunks(w) {
                out.push_str(&chunk.iter().collect::<String>());
                out.push('\n');
            }
        } else {
            let mut start = 0usize;
            while start < chs.len() {
                if chs.len() - start <= w {
                    out.push_str(&chs[start..].iter().collect::<String>());
                    out.push('\n');
                    break;
                }
                let window = &chs[start..start + w];
                if let Some(rel_sp) = window.iter().rposition(|&c| c == ' ' || c == '\t') {
                    let end = start + rel_sp + 1;
                    out.push_str(&chs[start..end].iter().collect::<String>());
                    out.push('\n');
                    start = end;
                } else {
                    out.push_str(&window.iter().collect::<String>());
                    out.push('\n');
                    start += w;
                }
            }
        }
    }
    ok_out(&out)
}

fn cmd_fmt(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut width = 75usize;
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
    let goal = ((width * 93) / 100).max(1);
    let mut out = String::new();
    let mut cur_line = String::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            if !cur_line.is_empty() {
                out.push_str(&cur_line);
                out.push('\n');
                cur_line.clear();
            }
            out.push('\n');
            continue;
        }
        for word in line.split_whitespace() {
            if cur_line.is_empty() {
                cur_line.push_str(word);
            } else if cur_line.len() + 1 + word.len() <= goal {
                cur_line.push(' ');
                cur_line.push_str(word);
            } else {
                out.push_str(&cur_line);
                out.push('\n');
                cur_line.clear();
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

fn cmd_csplit(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut silent = false;
    let mut elide_empty = false;
    let mut prefix = "xx".to_string();
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
    let mut split_points: Vec<usize> = Vec::new();
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
                let start_s = if found == 0 && search_from == 0 {
                    0
                } else {
                    search_from
                };
                if let Some(rel) = lines[start_s..].iter().position(|l| rx.is_match(l)) {
                    let hit = start_s + rel;
                    if hit > cur_idx || (hit == 0 && split_points.is_empty()) {
                        split_points.push(hit);
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
            if idx0 > cur_idx {
                split_points.push(idx0);
                cur_idx = idx0;
            }
        }
    }

    let mut boundaries = vec![0usize];
    for sp in split_points {
        if sp > *boundaries.last().unwrap() && sp <= lines.len() {
            boundaries.push(sp);
        }
    }
    boundaries.push(lines.len());

    let mut out = String::new();
    let mut file_no = 0usize;
    for w in boundaries.windows(2) {
        let chunk_lines = &lines[w[0]..w[1]];
        if elide_empty && chunk_lines.is_empty() {
            continue;
        }
        let content = if chunk_lines.is_empty() {
            String::new()
        } else {
            format!("{}\n", chunk_lines.join("\n"))
        };
        let fname = format!("{prefix}{file_no:0digits$}");
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
    let mut sep = "\t".to_string();
    let mut header = String::new();
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-T" || a == "-t" || a == "--omit-pagination" || a == "--omit-header" {
            omit_pagination = true;
            i += 1;
        } else if a == "-a" || a == "--across" {
            across = true;
            i += 1;
        } else if (a == "-h" || a == "--header") && i + 1 < args.len() {
            header = args[i + 1].clone();
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
        } else if !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let text = match read_inputs_or_stdin(&files, stdin, cwd, fs, "pr") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let lines: Vec<&str> = text.lines().collect();
    let mut out = String::new();
    if !omit_pagination && !header.is_empty() {
        out.push_str(&format!("\n\n{header}\n\n\n"));
    }
    if cols <= 1 {
        for l in lines {
            out.push_str(l);
            out.push('\n');
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

fn cmd_expand(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut tabstop = 8usize;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if (a == "-t" || a == "--tabs") && i + 1 < args.len() {
            tabstop = args[i + 1].parse().unwrap_or(8).max(1);
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-t").or_else(|| a.strip_prefix("--tabs=")) && !rest.is_empty() {
            tabstop = rest.parse().unwrap_or(8).max(1);
            i += 1;
        } else if !a.starts_with('-') {
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
    let mut out = String::new();
    for ch in text.chars() {
        if ch == '\n' {
            out.push('\n');
        } else if ch == '\t' {
            let line_len = out.rfind('\n').map(|p| out.len() - p - 1).unwrap_or(out.len());
            let spaces = tabstop - (line_len % tabstop);
            for _ in 0..spaces {
                out.push(' ');
            }
        } else {
            out.push(ch);
        }
    }
    ok_out(&out)
}

fn cmd_unexpand(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut tabstop = 8usize;
    let mut all_blanks = false;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-a" || a == "--all" {
            all_blanks = true;
            i += 1;
        } else if (a == "-t" || a == "--tabs") && i + 1 < args.len() {
            tabstop = args[i + 1].parse().unwrap_or(8).max(1);
            all_blanks = true;
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-t").or_else(|| a.strip_prefix("--tabs=")) && !rest.is_empty() {
            tabstop = rest.parse().unwrap_or(8).max(1);
            all_blanks = true;
            i += 1;
        } else if !a.starts_with('-') {
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
    let mut out = String::new();
    for line in text.split_inclusive('\n') {
        let (body, nl) = if let Some(b) = line.strip_suffix('\n') {
            (b, "\n")
        } else {
            (line, "")
        };
        let mut col = 0usize;
        let mut pending_spaces = 0usize;
        let mut seen_non_blank = false;
        for ch in body.chars() {
            if ch == ' ' && (!seen_non_blank || all_blanks) {
                pending_spaces += 1;
                col += 1;
                if col.is_multiple_of(tabstop) && pending_spaces > 0 {
                    out.push('\t');
                    pending_spaces = 0;
                }
            } else {
                for _ in 0..pending_spaces {
                    out.push(' ');
                }
                pending_spaces = 0;
                if ch != ' ' && ch != '\t' {
                    seen_non_blank = true;
                }
                out.push(ch);
                col += 1;
            }
        }
        for _ in 0..pending_spaces {
            out.push(' ');
        }
        out.push_str(nl);
    }
    ok_out(&out)
}

fn cmd_column(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut table = false;
    let mut sep: Option<String> = None;
    let mut out_sep = "  ".to_string();
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-t" {
            table = true;
            i += 1;
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
    let cols = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    let mut widths = vec![0usize; cols];
    for r in &rows {
        for (c, cell) in r.iter().enumerate() {
            widths[c] = widths[c].max(cell.len());
        }
    }
    let mut out = String::new();
    for r in &rows {
        for (c, cell) in r.iter().enumerate() {
            if c > 0 {
                out.push_str(&out_sep);
            }
            if c + 1 < r.len() {
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
    let mut range: Option<(usize, usize)> = None;
    let mut items = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        if args[i] == "-n" && i + 1 < args.len() {
            head_count = args[i + 1].parse().ok();
            i += 2;
        } else if args[i] == "-e" {
            echo_mode = true;
            i += 1;
        } else if args[i] == "-i" && i + 1 < args.len() {
            if let Some((a, b)) = args[i + 1].split_once('-') {
                range = Some((a.parse().unwrap_or(0), b.parse().unwrap_or(0)));
            }
            i += 2;
        } else {
            items.push(args[i].clone());
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
        text.lines().map(|s| s.to_string()).collect()
    };
    if let Some(n) = head_count {
        lines.truncate(n);
    }
    if lines.is_empty() {
        ok_out("")
    } else {
        ok_out(&format!("{}\n", lines.join("\n")))
    }
}

fn cmd_split(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut lines_per = 1000usize;
    let mut positional = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        if args[i] == "-l" && i + 1 < args.len() {
            lines_per = args[i + 1].parse().unwrap_or(1000);
            i += 2;
        } else if !args[i].starts_with('-') {
            positional.push(args[i].clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let input_files: Vec<String> = positional.iter().take(1).cloned().collect();
    let prefix = positional.get(1).map(|s| s.as_str()).unwrap_or("x");
    let text = match read_inputs_or_stdin(&input_files, stdin, cwd, fs, "split") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let all_lines: Vec<&str> = text.split_inclusive('\n').collect();
    for (idx, chunk) in all_lines.chunks(lines_per.max(1)).enumerate() {
        let c1 = (b'a' + ((idx / 26) as u8 % 26)) as char;
        let c2 = (b'a' + (idx % 26) as u8) as char;
        let out_path = resolve_posix_path(cwd, &format!("{prefix}{c1}{c2}"));
        let _ = fs.write_file(&out_path, chunk.concat().as_bytes());
    }
    let _ = (BTreeSet::<u8>::new(), normalize_posix_path);
    ok_out("")
}

fn cmd_dd(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut in_file: Option<String> = None;
    let mut out_file: Option<String> = None;
    let mut bs = 512usize;
    let mut skip = 0usize;
    let mut count: Option<usize> = None;
    let mut lcase = false;
    let mut ucase = false;
    for a in args {
        if let Some(v) = a.strip_prefix("if=") {
            in_file = Some(v.to_string());
        } else if let Some(v) = a.strip_prefix("of=") {
            out_file = Some(v.to_string());
        } else if let Some(v) = a.strip_prefix("bs=") {
            bs = v.parse().unwrap_or(512).max(1);
        } else if let Some(v) = a.strip_prefix("skip=") {
            skip = v.parse().unwrap_or(0);
        } else if let Some(v) = a.strip_prefix("count=") {
            count = v.parse().ok();
        } else if let Some(v) = a.strip_prefix("conv=") {
            if v.contains("lcase") {
                lcase = true;
            }
            if v.contains("ucase") {
                ucase = true;
            }
        }
    }
    let data = if let Some(inf) = in_file {
        let full = resolve_posix_path(cwd, &inf);
        fs.read_file(&full).unwrap_or_default()
    } else {
        stream_string_to_bytes(stdin)
    };
    let start = (skip * bs).min(data.len());
    let end = match count {
        Some(c) => (start + c * bs).min(data.len()),
        None => data.len(),
    };
    let mut slice = data[start..end].to_vec();
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
    if let Some(outf) = out_file {
        let full = resolve_posix_path(cwd, &outf);
        let _ = fs.write_file(&full, &slice);
        ok_out("")
    } else {
        ok_out(&String::from_utf8_lossy(&slice))
    }
}

fn cmd_install(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut create_dirs = false;
    let mut mode: Option<u32> = None;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-D" => create_dirs = true,
            "-m" if i + 1 < args.len() => {
                i += 1;
                mode = u32::from_str_radix(&args[i], 8).ok();
            }
            a if !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    if files.len() >= 2 {
        let src = resolve_posix_path(cwd, &files[0]);
        let dst = resolve_posix_path(cwd, &files[1]);
        if create_dirs {
            let parent = dirname_posix_path(&dst);
            let _ = fs.mkdir_all(&parent);
        }
        if let Ok(bytes) = fs.read_file(&src) {
            let _ = fs.write_file(&dst, &bytes);
            if let Some(m) = mode {
                let _ = fs.chmod(&dst, 0o100000 | m);
            }
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
    let mut empty_str = String::new();
    let mut out_format: Vec<String> = Vec::new();
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-t" && i + 1 < args.len() {
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
            for spec in args[i + 1].split(|c: char| c == ',' || c.is_whitespace()).filter(|s| !s.is_empty()) {
                out_format.push(spec.to_string());
            }
            i += 2;
        } else if a == "-i" {
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
                    parts.push(val.clone());
                }
            }
        }
        if let Some(r) = r2 {
            for (idx, val) in r.iter().enumerate() {
                if idx + 1 != f2_idx {
                    parts.push(val.clone());
                }
            }
        }
        parts.join(&sep)
    };

    let mut out = String::new();
    let mut i1 = 0usize;
    let mut i2 = 0usize;

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
    let files: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
    let convert = |s: &str| -> String {
        let lf = s.replace("\r\n", "\n");
        if to_dos {
            lf.replace('\n', "\r\n")
        } else {
            lf
        }
    };
    if files.is_empty() {
        return ok_out(&convert(stdin));
    }
    for f in files {
        let p = resolve_posix_path(cwd, f);
        if let Ok(bytes) = fs.read_file(&p) {
            let text = String::from_utf8_lossy(&bytes);
            let converted = convert(&text);
            let _ = fs.write_file(&p, converted.as_bytes());
        }
    }
    ok_out("")
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
    let mut out = String::new();
    let mut remaining = nodes;
    let mut had_cycle = false;
    while !remaining.is_empty() {
        let zero_pos = remaining.iter().position(|n| in_deg.get(n).copied().unwrap_or(0) == 0);
        let idx = if let Some(p) = zero_pos {
            p
        } else {
            had_cycle = true;
            0
        };
        let u = remaining.remove(idx);
        out.push_str(&u);
        out.push('\n');
        if let Some(neighbors) = adj.get(&u) {
            for v in neighbors {
                if let Some(d) = in_deg.get_mut(v) {
                    *d = d.saturating_sub(1);
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
    let mut size_spec = String::from("0");
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if (a == "-s" || a == "--size") && i + 1 < args.len() {
            size_spec = args[i + 1].clone();
            i += 2;
        } else if let Some(s) = a.strip_prefix("--size=") {
            size_spec = s.to_string();
            i += 1;
        } else if let Some(s) = a.strip_prefix("-s") && !s.is_empty() {
            size_spec = s.to_string();
            i += 1;
        } else if !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let trimmed = size_spec.trim();
    let (op, rest) = if let Some(r) = trimmed.strip_prefix('+') {
        ('+', r)
    } else if let Some(r) = trimmed.strip_prefix('-') {
        ('-', r)
    } else {
        ('=', trimmed)
    };
    let num_len = rest.chars().take_while(|c| c.is_ascii_digit()).count();
    let base_num = rest[..num_len].parse::<usize>().unwrap_or(0);
    let unit = rest[num_len..].to_ascii_uppercase();
    let mult = match unit.as_str() {
        "K" | "KB" | "KIB" => 1024usize,
        "M" | "MB" | "MIB" => 1024 * 1024,
        "G" | "GB" | "GIB" => 1024 * 1024 * 1024,
        _ => 1usize,
    };
    let delta = base_num.saturating_mul(mult);

    for f in files {
        let full = resolve_posix_path(cwd, &f);
        let mut bytes = fs.read_file(&full).unwrap_or_default();
        let target_len = match op {
            '+' => bytes.len().saturating_add(delta),
            '-' => bytes.len().saturating_sub(delta),
            _ => delta,
        };
        bytes.resize(target_len, 0u8);
        let _ = fs.write_file(&full, &bytes);
    }
    ok_out("")
}
