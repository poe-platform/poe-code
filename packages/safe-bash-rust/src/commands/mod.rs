pub mod archive;
pub mod coreutils;
pub mod fs;
pub mod search;
pub mod structured;
pub mod text;

use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::SafeBashFs;
use std::cell::RefCell;
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
struct TimeoutFrame {
    id: u64,
    deadline_ms: f64,
    kill_deadline_ms: Option<f64>,
    sig_num: i32,
    expired: bool,
    killed: bool,
}

#[derive(Default)]
struct VirtualClock {
    now_ms: f64,
    next_id: u64,
    stack: Vec<TimeoutFrame>,
    expired_id: Option<u64>,
}

thread_local! {
    static VIRTUAL_CLOCK: RefCell<VirtualClock> = RefCell::new(VirtualClock::default());
}

pub fn reset_virtual_clock() {
    VIRTUAL_CLOCK.with(|c| {
        let mut clock = c.borrow_mut();
        clock.now_ms = 0.0;
        clock.next_id = 0;
        clock.stack.clear();
        clock.expired_id = None;
    });
}

pub fn virtual_clock_elapsed_ms() -> f64 {
    VIRTUAL_CLOCK.with(|c| c.borrow().now_ms)
}

pub fn is_timeout_expired() -> bool {
    VIRTUAL_CLOCK.with(|c| c.borrow().expired_id.is_some())
}

const SIGNAL_NAMES: [&str; 31] = [
    "HUP", "INT", "QUIT", "ILL", "TRAP", "ABRT", "BUS", "FPE", "KILL", "USR1", "SEGV", "USR2",
    "PIPE", "ALRM", "TERM", "STKFLT", "CHLD", "CONT", "STOP", "TSTP", "TTIN", "TTOU", "URG",
    "XCPU", "XFSZ", "VTALRM", "PROF", "WINCH", "IO", "PWR", "SYS",
];

pub fn signal_name(num: i32) -> String {
    if (1..=31).contains(&num) {
        SIGNAL_NAMES[(num - 1) as usize].to_string()
    } else {
        num.to_string()
    }
}

pub fn parse_signal_spec(spec: &str) -> Option<i32> {
    if spec.is_empty() || spec.trim() != spec {
        return None;
    }
    if spec.bytes().all(|b| b.is_ascii_digit()) {
        let n = spec.parse::<i32>().ok()?;
        return if (0..=64).contains(&n) { Some(n) } else { None };
    }
    let up = spec.to_ascii_uppercase();
    let name = up.strip_prefix("SIG").unwrap_or(&up);
    if name == "EXIT" {
        return Some(0);
    }
    if name == "IOT" {
        return Some(6);
    }
    if name == "CLD" {
        return Some(17);
    }
    if name == "POLL" {
        return Some(29);
    }
    if name == "RTMIN" {
        return Some(34);
    }
    if name == "RTMAX" {
        return Some(64);
    }
    if let Some(rest) = name.strip_prefix("RTMIN+") {
        if !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()) {
            let offset = rest.parse::<i32>().ok()?;
            if (1..=30).contains(&offset) {
                return Some(34 + offset);
            }
        }
        return None;
    }
    if let Some(rest) = name.strip_prefix("RTMAX-") {
        if !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()) {
            let offset = rest.parse::<i32>().ok()?;
            if (1..=30).contains(&offset) {
                return Some(64 - offset);
            }
        }
        return None;
    }
    SIGNAL_NAMES
        .iter()
        .position(|&s| s == name)
        .map(|i| (i as i32) + 1)
}

fn is_signal_ignored(sig_num: i32, env: &BTreeMap<String, String>) -> bool {
    if matches!(sig_num, 0 | 17 | 18 | 23 | 28) {
        return true;
    }
    if matches!(sig_num, 9 | 19) {
        return false;
    }
    let sname = signal_name(sig_num);
    if env
        .get(&format!("__trap_ignored__SIG{sname}"))
        .map(|v| v == "1")
        .unwrap_or(false)
        || env
            .get(&format!("__trap_ignored__SIG{sig_num}"))
            .map(|v| v == "1")
            .unwrap_or(false)
    {
        return true;
    }
    false
}

pub fn advance_virtual_clock(ms: f64, env: &BTreeMap<String, String>) {
    if ms <= 0.0 || !ms.is_finite() {
        return;
    }
    VIRTUAL_CLOCK.with(|c| {
        let mut clock = c.borrow_mut();
        if clock.expired_id.is_some() {
            return;
        }
        let target = clock.now_ms + ms;
        let mut earliest_stop: Option<(f64, u64)> = None;
        for frame in clock.stack.iter_mut() {
            if !frame.expired && target >= frame.deadline_ms {
                frame.expired = true;
                let stop_sig = (19..=22).contains(&frame.sig_num)
                    && (frame.sig_num == 19 || !is_signal_ignored(frame.sig_num, env));
                let ignored = is_signal_ignored(frame.sig_num, env);
                if !stop_sig && !ignored {
                    match earliest_stop {
                        None => earliest_stop = Some((frame.deadline_ms, frame.id)),
                        Some((d, _)) if frame.deadline_ms < d => {
                            earliest_stop = Some((frame.deadline_ms, frame.id))
                        }
                        _ => {}
                    }
                }
            }
            if frame.expired
                && !frame.killed
                && let Some(kd) = frame.kill_deadline_ms
                && target >= kd
            {
                frame.killed = true;
                match earliest_stop {
                    None => earliest_stop = Some((kd, frame.id)),
                    Some((d, _)) if kd < d => earliest_stop = Some((kd, frame.id)),
                    _ => {}
                }
            }
        }
        if let Some((stop_time, id)) = earliest_stop {
            clock.now_ms = stop_time;
            clock.expired_id = Some(id);
        } else {
            clock.now_ms = target;
        }
    });
}

pub fn tick_virtual_loop(env: &BTreeMap<String, String>) {
    let has_active = VIRTUAL_CLOCK.with(|c| {
        let clock = c.borrow();
        !clock.stack.is_empty() && clock.expired_id.is_none()
    });
    if has_active {
        advance_virtual_clock(0.5, env);
    }
}

#[derive(Clone, Debug)]
pub enum SleepInterval {
    Decimal {
        coefficient: String,
        scale: i128,
        multiplier: u64,
    },
    Millis(u64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SleepParseError {
    Invalid,
    Overflow,
}

const MAX_SAFE_INT_U128: u128 = 9_007_199_254_740_991;

fn trim_leading_ascii_ws(raw: &str) -> &str {
    let bytes = raw.as_bytes();
    let mut i = 0usize;
    while i < bytes.len()
        && matches!(
            bytes[i],
            b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c
        )
    {
        i += 1;
    }
    &raw[i..]
}

fn parse_signed_i128(s: &str) -> Option<i128> {
    if s.is_empty() {
        return None;
    }
    let (neg, digits) = if let Some(r) = s.strip_prefix('-') {
        (true, r)
    } else if let Some(r) = s.strip_prefix('+') {
        (false, r)
    } else {
        (false, s)
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let trimmed = digits.trim_start_matches('0');
    if trimmed.is_empty() {
        return Some(0);
    }
    if trimmed.len() > 36 {
        return Some(if neg { i128::MIN / 2 } else { i128::MAX / 2 });
    }
    let val = trimmed.parse::<i128>().ok()?;
    Some(if neg { -val } else { val })
}

pub fn parse_sleep_interval(raw: &str) -> Result<SleepInterval, SleepParseError> {
    let s = trim_leading_ascii_ws(raw);
    if s.is_empty() {
        return Err(SleepParseError::Invalid);
    }
    let is_hex_no_p = {
        let r = s.strip_prefix('-').or_else(|| s.strip_prefix('+')).unwrap_or(s);
        (r.starts_with("0x") || r.starts_with("0X")) && !r.contains('p') && !r.contains('P')
    };
    let (body, multiplier) = if let Some(b) = s.strip_suffix('s') {
        (b, 1_000u64)
    } else if let Some(b) = s.strip_suffix('m') {
        (b, 60_000u64)
    } else if let Some(b) = s.strip_suffix('h') {
        (b, 3_600_000u64)
    } else if !is_hex_no_p && let Some(b) = s.strip_suffix('d') {
        (b, 86_400_000u64)
    } else {
        (s, 1_000u64)
    };
    if body.is_empty() {
        return Err(SleepParseError::Invalid);
    }
    let (sign, rest) = if let Some(r) = body.strip_prefix('-') {
        (-1i32, r)
    } else if let Some(r) = body.strip_prefix('+') {
        (1i32, r)
    } else {
        (1i32, body)
    };

    if let Some(hex_body) = rest.strip_prefix("0x").or_else(|| rest.strip_prefix("0X")) {
        let (mantissa, exp_str) = if let Some((m, e)) = hex_body.split_once('p') {
            (m, Some(e))
        } else if let Some((m, e)) = hex_body.split_once('P') {
            (m, Some(e))
        } else {
            (hex_body, None)
        };
        let (whole, frac) = if let Some((w, f)) = mantissa.split_once('.') {
            if f.contains('.') {
                return Err(SleepParseError::Invalid);
            }
            (w, f)
        } else {
            (mantissa, "")
        };
        if (whole.is_empty() && frac.is_empty())
            || !whole.bytes().all(|b| b.is_ascii_hexdigit())
            || !frac.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(SleepParseError::Invalid);
        }
        let exp = match exp_str {
            Some(es) => parse_signed_i128(es).ok_or(SleepParseError::Invalid)?,
            None => 0i128,
        };
        let digits: String = format!("{whole}{frac}")
            .trim_start_matches('0')
            .to_string();
        if digits.is_empty() {
            return Ok(SleepInterval::Millis(0));
        }
        if sign < 0 {
            return Err(SleepParseError::Invalid);
        }
        let first_nibble = u8::from_str_radix(&digits[0..1], 16).unwrap_or(1);
        let first_bits = (8 - first_nibble.leading_zeros()) as i128;
        let bits = (digits.len() as i128 - 1) * 4 + first_bits;
        let shift = exp - (frac.len() as i128) * 4;
        if bits + shift > 44 {
            return Err(SleepParseError::Overflow);
        }
        if bits + shift < -1074 {
            return Ok(SleepInterval::Millis(0));
        }
        let sign_str = if sign < 0 { "-" } else { "" };
        let val = parse_hex_float(sign_str, whole, frac, exp) * (multiplier as f64);
        if !val.is_finite() || val.ceil() > (MAX_SAFE_INT_U128 as f64) {
            return Err(SleepParseError::Overflow);
        }
        return Ok(SleepInterval::Millis(val.ceil() as u64));
    }

    let (mantissa, exp_str) = if let Some((m, e)) = rest.split_once('e') {
        (m, Some(e))
    } else if let Some((m, e)) = rest.split_once('E') {
        (m, Some(e))
    } else {
        (rest, None)
    };
    let (whole, frac) = if let Some((w, f)) = mantissa.split_once('.') {
        if f.contains('.') {
            return Err(SleepParseError::Invalid);
        }
        (w, f)
    } else {
        (mantissa, "")
    };
    if (whole.is_empty() && frac.is_empty())
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !frac.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(SleepParseError::Invalid);
    }
    let exp = match exp_str {
        Some(es) => parse_signed_i128(es).ok_or(SleepParseError::Invalid)?,
        None => 0i128,
    };
    let raw_coeff = format!("{whole}{frac}");
    let trimmed = raw_coeff.trim_start_matches('0');
    if trimmed.is_empty() {
        return Ok(SleepInterval::Millis(0));
    }
    if sign < 0 {
        return Err(SleepParseError::Invalid);
    }
    let trimmed_right = trimmed.trim_end_matches('0');
    let trailing_zeros = (trimmed.len() - trimmed_right.len()) as i128;
    let scale = exp - (frac.len() as i128) + trailing_zeros;
    if (trimmed_right.len() as i128) + scale > 16 {
        return Err(SleepParseError::Overflow);
    }
    Ok(SleepInterval::Decimal {
        coefficient: trimmed_right.to_string(),
        scale,
        multiplier,
    })
}

fn parse_hex_float(sign: &str, whole: &str, frac: &str, exp: i128) -> f64 {
    let mut val = 0.0f64;
    for ch in whole.chars() {
        let d = ch.to_digit(16).unwrap_or(0) as f64;
        val = val * 16.0 + d;
    }
    let mut factor = 1.0 / 16.0;
    for ch in frac.chars() {
        let d = ch.to_digit(16).unwrap_or(0) as f64;
        val += d * factor;
        factor /= 16.0;
    }
    let clamped_exp = exp.clamp(-2000, 2000) as i32;
    let res = val * 2.0f64.powi(clamped_exp);
    if sign == "-" { -res } else { res }
}

const COLUMN_RADIX: u128 = 1_000_000_000;

fn add_column(columns: &mut BTreeMap<i128, u128>, mut index: i128, mut value: u128) {
    while value > 0 {
        let total = columns.get(&index).copied().unwrap_or(0) + value;
        let rem = total % COLUMN_RADIX;
        if rem > 0 {
            columns.insert(index, rem);
        } else {
            columns.remove(&index);
        }
        value = total / COLUMN_RADIX;
        index += 1;
    }
}

pub fn sum_sleep_intervals_ms(intervals: &[SleepInterval]) -> Result<u64, ()> {
    let mut total_ms: u128 = 0;
    let mut frac_cols: BTreeMap<i128, u128> = BTreeMap::new();

    for iv in intervals {
        match iv {
            SleepInterval::Millis(ms) => {
                total_ms = total_ms.saturating_add(*ms as u128);
            }
            SleepInterval::Decimal {
                coefficient,
                scale,
                multiplier,
            } => {
                let mut offset = 0usize;
                let bytes = coefficient.as_bytes();
                let mut end = bytes.len();
                while end > 0 {
                    let start = end.saturating_sub(9);
                    let chunk_str = std::str::from_utf8(&bytes[start..end]).unwrap_or("0");
                    let chunk_val = chunk_str.parse::<u128>().unwrap_or(0) * (*multiplier as u128);
                    let digits_after = offset as i128;
                    let power = *scale + digits_after;
                    if power >= 0 {
                        if power > 20 {
                            return Err(());
                        }
                        let factor = 10u128.checked_pow(power as u32).ok_or(())?;
                        let add = chunk_val.checked_mul(factor).ok_or(())?;
                        total_ms = total_ms.checked_add(add).ok_or(())?;
                    } else {
                        let neg = -power;
                        let col = -((neg + 8) / 9);
                        let shift = ((-col) * 9 - neg) as u32;
                        let factor = 10u128.pow(shift);
                        add_column(&mut frac_cols, col, chunk_val * factor);
                    }
                    end = start;
                    offset += 9;
                }
            }
        }
        if total_ms > MAX_SAFE_INT_U128 {
            return Err(());
        }
    }

    if let Some(int_from_frac) = frac_cols.remove(&0) {
        total_ms = total_ms.saturating_add(int_from_frac);
    }
    for (&k, &v) in frac_cols.iter() {
        if k > 0 && v > 0 {
            let factor = COLUMN_RADIX.checked_pow(k as u32).ok_or(())?;
            total_ms = total_ms.saturating_add(v.saturating_mul(factor));
        }
    }
    let has_frac = frac_cols.iter().any(|(&k, &v)| k < 0 && v > 0);
    if has_frac {
        total_ms = total_ms.saturating_add(1);
    }
    if total_ms > MAX_SAFE_INT_U128 {
        return Err(());
    }
    Ok(total_ms as u64)
}

fn parse_timeout_duration_ms(raw: &str) -> Option<f64> {
    if raw.is_empty() {
        return None;
    }
    let s = trim_leading_ascii_ws(raw);
    if s.is_empty() || s.trim_end() != s {
        return None;
    }
    let (neg, after_sign) = if let Some(r) = s.strip_prefix('-') {
        (true, r)
    } else if let Some(r) = s.strip_prefix('+') {
        (false, r)
    } else {
        (false, s)
    };
    if after_sign.is_empty() {
        return None;
    }
    let lower = after_sign.to_ascii_lowercase();
    if let Some(rest_inf) = lower.strip_prefix("infinity").or_else(|| lower.strip_prefix("inf")) {
        if neg {
            return None;
        }
        if rest_inf.is_empty() || matches!(rest_inf, "s" | "m" | "h" | "d") {
            return Some(f64::INFINITY);
        }
        return None;
    }
    let is_hex = after_sign.starts_with("0x") || after_sign.starts_with("0X");
    let is_hex_no_p = is_hex && !after_sign.contains('p') && !after_sign.contains('P');
    let (body, mult) = if let Some(b) = after_sign.strip_suffix('s') {
        (b, 1_000.0)
    } else if let Some(b) = after_sign.strip_suffix('m') {
        (b, 60_000.0)
    } else if let Some(b) = after_sign.strip_suffix('h') {
        (b, 3_600_000.0)
    } else if !is_hex_no_p && let Some(b) = after_sign.strip_suffix('d') {
        (b, 86_400_000.0)
    } else {
        (after_sign, 1_000.0)
    };
    if body.is_empty() {
        return None;
    }
    if let Some(hex) = body.strip_prefix("0x").or_else(|| body.strip_prefix("0X")) {
        let (mant, exp_s) = if let Some((m, e)) = hex.split_once('p') {
            (m, Some(e))
        } else if let Some((m, e)) = hex.split_once('P') {
            (m, Some(e))
        } else {
            (hex, None)
        };
        let (w, f) = if let Some((w, f)) = mant.split_once('.') {
            if f.contains('.') {
                return None;
            }
            (w, f)
        } else {
            (mant, "")
        };
        if (w.is_empty() && f.is_empty())
            || !w.bytes().all(|b| b.is_ascii_hexdigit())
            || !f.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return None;
        }
        let exp = match exp_s {
            Some(es) => parse_signed_i128(es)?,
            None => 0,
        };
        let digits_nonzero = w.bytes().chain(f.bytes()).any(|b| b != b'0');
        if !digits_nonzero {
            return Some(0.0);
        }
        if neg {
            return None;
        }
        if exp > 1024 {
            return Some(f64::INFINITY);
        }
        let val = parse_hex_float("", w, f, exp);
        if !val.is_finite() {
            return Some(f64::INFINITY);
        }
        let ms = (val * mult).ceil();
        return Some(if ms.is_finite() { ms.max(1.0) } else { f64::MAX });
    }

    let (mant, exp_s) = if let Some((m, e)) = body.split_once('e') {
        (m, Some(e))
    } else if let Some((m, e)) = body.split_once('E') {
        (m, Some(e))
    } else {
        (body, None)
    };
    let (w, f) = if let Some((w, f)) = mant.split_once('.') {
        if f.contains('.') {
            return None;
        }
        (w, f)
    } else {
        (mant, "")
    };
    if (w.is_empty() && f.is_empty())
        || !w.bytes().all(|b| b.is_ascii_digit())
        || !f.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let exp = match exp_s {
        Some(es) => parse_signed_i128(es)?,
        None => 0,
    };
    let digits_nonzero = w.bytes().chain(f.bytes()).any(|b| b != b'0');
    if !digits_nonzero {
        return Some(0.0);
    }
    if neg {
        return None;
    }
    if exp > 310 {
        return Some(f64::INFINITY);
    }
    let val = body.parse::<f64>().unwrap_or(f64::INFINITY);
    if !val.is_finite() {
        return Some(f64::INFINITY);
    }
    let ms = (val * mult).ceil();
    Some(if ms.is_finite() { ms.max(1.0) } else { f64::MAX })
}

pub fn try_run_command<F>(
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
    if cmd == "env" && !args.is_empty() {
        let mut idx = 0usize;
        let mut ignore_env = false;
        let mut unsets = Vec::new();
        let mut overrides = Vec::new();
        while idx < args.len() {
            let a = &args[idx];
            if a == "-i" || a == "--ignore-environment" || a == "-" {
                ignore_env = true;
                idx += 1;
            } else if a == "-u" && idx + 1 < args.len() {
                unsets.push(args[idx + 1].clone());
                idx += 2;
            } else if let Some(rest) = a.strip_prefix("--unset=") {
                unsets.push(rest.to_string());
                idx += 1;
            } else if let Some(rest) = a.strip_prefix("-u") && !rest.is_empty() {
                unsets.push(rest.to_string());
                idx += 1;
            } else if let Some((k, v)) = a.split_once('=') {
                if !k.is_empty() && !k.starts_with('-') {
                    overrides.push((k.to_string(), v.to_string()));
                    idx += 1;
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        let mut sub_env = if ignore_env {
            BTreeMap::new()
        } else {
            env.clone()
        };
        for u in unsets {
            sub_env.remove(&u);
        }
        for (k, v) in overrides {
            sub_env.remove(&format!("__unexported__{k}"));
            sub_env.insert(k, v);
        }
        if idx < args.len() {
            return Some(exec_sub(&args[idx..], stdin, cwd, &mut sub_env));
        }
        return coreutils::try_run_coreutil("printenv", &[], stdin, cwd, &sub_env, fs);
    }

    if cmd == "timeout" {
        return Some(run_timeout_command(args, stdin, cwd, env, exec_sub));
    }

    if let Some(res) = coreutils::try_run_coreutil(cmd, args, stdin, cwd, env, fs) {
        return Some(res);
    }
    if let Some(res) = fs::try_run_fs_command(cmd, args, stdin, cwd, env, fs) {
        return Some(res);
    }
    if let Some(res) = search::try_run_search_command(cmd, args, stdin, cwd, env, fs, exec_sub) {
        return Some(res);
    }
    if let Some(res) = text::try_run_text_command(cmd, args, stdin, cwd, env, fs) {
        return Some(res);
    }
    if let Some(res) = structured::try_run_structured_command(cmd, args, stdin, cwd, env, fs) {
        return Some(res);
    }
    if let Some(res) = archive::try_run_archive_command(cmd, args, stdin, cwd, env, fs) {
        return Some(res);
    }
    None
}

fn timeout_err(msg: &str) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: String::new(),
        stderr: format!("timeout: {msg}\n"),
        exit_code: 125,
    }
}

fn run_timeout_command<F>(
    args: &[String],
    stdin: &str,
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    mut exec_sub: F,
) -> BuiltinOutcome
where
    F: FnMut(&[String], &str, &mut String, &mut BTreeMap<String, String>) -> BuiltinOutcome,
{
    let mut idx = 0usize;
    let mut sig_num = 15i32;
    let mut preserve_status = false;
    let mut verbose = false;
    let mut kill_after_ms: Option<f64> = None;

    while idx < args.len() {
        let a = &args[idx];
        if a == "--" {
            idx += 1;
            break;
        }
        if a == "--help" {
            return BuiltinOutcome {
                stdout: "Usage: timeout [OPTION] DURATION COMMAND [ARG]...\nRun a virtual-bash command with a cooperative time limit.\n".to_string(),
                stderr: String::new(),
                exit_code: 0,
            };
        }
        if a == "--version" {
            return BuiltinOutcome {
                stdout: "timeout (virtual-bash cooperative profile)\n".to_string(),
                stderr: String::new(),
                exit_code: 0,
            };
        }
        if !a.starts_with('-') || a == "-" {
            break;
        }
        if a == "--foreground" {
            idx += 1;
            continue;
        }
        if a == "--preserve-status" {
            preserve_status = true;
            idx += 1;
            continue;
        }
        if a == "--verbose" {
            verbose = true;
            idx += 1;
            continue;
        }
        if let Some(val) = a.strip_prefix("--signal=") {
            let Some(parsed) = parse_signal_spec(val) else {
                return timeout_err("invalid signal");
            };
            sig_num = parsed;
            idx += 1;
            continue;
        }
        if a == "--signal" {
            let Some(val) = args.get(idx + 1) else {
                return timeout_err("invalid signal");
            };
            let Some(parsed) = parse_signal_spec(val) else {
                return timeout_err("invalid signal");
            };
            sig_num = parsed;
            idx += 2;
            continue;
        }
        if let Some(val) = a.strip_prefix("--kill-after=") {
            let Some(ms) = parse_timeout_duration_ms(val) else {
                return timeout_err("invalid duration");
            };
            kill_after_ms = if ms > 0.0 && ms.is_finite() { Some(ms) } else { None };
            idx += 1;
            continue;
        }
        if a == "--kill-after" {
            let Some(val) = args.get(idx + 1) else {
                return timeout_err("missing duration");
            };
            let Some(ms) = parse_timeout_duration_ms(val) else {
                return timeout_err("invalid duration");
            };
            kill_after_ms = if ms > 0.0 && ms.is_finite() { Some(ms) } else { None };
            idx += 2;
            continue;
        }
        if a.starts_with("--") {
            return timeout_err("invalid option");
        }

        let chars: Vec<char> = a[1..].chars().collect();
        let mut ci = 0usize;
        let mut consumed_next = false;
        while ci < chars.len() {
            match chars[ci] {
                'f' => ci += 1,
                'p' => {
                    preserve_status = true;
                    ci += 1;
                }
                'v' => {
                    verbose = true;
                    ci += 1;
                }
                's' => {
                    let rest: String = chars[ci + 1..].iter().collect();
                    let val = if !rest.is_empty() {
                        rest
                    } else if let Some(next) = args.get(idx + 1) {
                        consumed_next = true;
                        next.clone()
                    } else {
                        return timeout_err("invalid signal");
                    };
                    let Some(parsed) = parse_signal_spec(&val) else {
                        return timeout_err("invalid signal");
                    };
                    sig_num = parsed;
                    break;
                }
                'k' => {
                    let rest: String = chars[ci + 1..].iter().collect();
                    let val = if !rest.is_empty() {
                        rest
                    } else if let Some(next) = args.get(idx + 1) {
                        consumed_next = true;
                        next.clone()
                    } else {
                        return timeout_err("missing duration");
                    };
                    let Some(ms) = parse_timeout_duration_ms(&val) else {
                        return timeout_err("invalid duration");
                    };
                    kill_after_ms = if ms > 0.0 && ms.is_finite() { Some(ms) } else { None };
                    break;
                }
                _ => {
                    return timeout_err("invalid option");
                }
            }
        }
        idx += if consumed_next { 2 } else { 1 };
    }

    let Some(dur_token) = args.get(idx) else {
        return timeout_err("missing duration");
    };
    let Some(duration_ms) = parse_timeout_duration_ms(dur_token) else {
        return timeout_err("invalid duration");
    };
    let Some(command_name) = args.get(idx + 1) else {
        return timeout_err("missing command");
    };

    let stop_signal = (19..=22).contains(&sig_num);
    if stop_signal && kill_after_ms.is_none() {
        return timeout_err("stop signals require finite kill-after on this host");
    }
    if duration_ms > 0.0
        && duration_ms.is_finite()
        && env
            .get("__has_finite_shared_quota")
            .map(|v| v == "1")
            .unwrap_or(false)
    {
        return timeout_err("worker escalation cannot preserve finite shared interpreter quotas");
    }

    let sub_words = &args[idx + 1..];
    if duration_ms == 0.0 || !duration_ms.is_finite() {
        return exec_sub(sub_words, stdin, cwd, env);
    }

    let frame_id = VIRTUAL_CLOCK.with(|c| {
        let mut clock = c.borrow_mut();
        clock.next_id += 1;
        let id = clock.next_id;
        let deadline_ms = clock.now_ms + duration_ms;
        let kill_deadline_ms = kill_after_ms.map(|ka| deadline_ms + ka);
        clock.stack.push(TimeoutFrame {
            id,
            deadline_ms,
            kill_deadline_ms,
            sig_num,
            expired: false,
            killed: false,
        });
        id
    });

    let mut out = exec_sub(sub_words, stdin, cwd, env);

    let (this_expired, this_killed) = VIRTUAL_CLOCK.with(|c| {
        let mut clock = c.borrow_mut();
        let mut exp = false;
        let mut kld = false;
        if let Some(pos) = clock.stack.iter().position(|f| f.id == frame_id) {
            let removed = clock.stack.remove(pos);
            exp = removed.expired;
            kld = removed.killed;
        }
        if clock.expired_id == Some(frame_id) {
            clock.expired_id = None;
            exp = true;
        }
        (exp, kld)
    });

    if this_expired {
        if verbose {
            out.stderr.push_str(&format!(
                "timeout: sending signal {} to command ‘{command_name}’\n",
                signal_name(sig_num)
            ));
            if this_killed {
                out.stderr.push_str(&format!(
                    "timeout: sending signal KILL to command ‘{command_name}’\n"
                ));
            }
        }
        let ignored = is_signal_ignored(sig_num, env);
        if this_killed {
            out.exit_code = 137;
        } else if !ignored {
            out.exit_code = if sig_num == 9 || preserve_status {
                128 + sig_num
            } else {
                124
            };
        }
    }

    out
}
