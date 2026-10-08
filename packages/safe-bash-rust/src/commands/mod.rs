pub mod archive;
pub mod coreutils;
pub mod fs;
pub mod search;
pub mod structured;
pub mod text;

use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::SafeBashFs;
use std::collections::BTreeMap;

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
        let mut idx = 0usize;
        let mut sig_num = 15i32;
        let mut preserve_status = false;
        let mut has_kill_after = false;
        while idx < args.len() && args[idx].starts_with('-') {
            let a = &args[idx];
            if a == "--preserve-status" {
                preserve_status = true;
                idx += 1;
            } else if a.starts_with("--kill-after=") || (a.starts_with("-k") && a.len() > 2) {
                has_kill_after = true;
                idx += 1;
            } else if (a == "-s" || a == "--signal" || a == "-k" || a == "--kill-after") && idx + 1 < args.len() {
                if a == "-k" || a == "--kill-after" {
                    has_kill_after = true;
                }
                if a == "-s" || a == "--signal" {
                    let s = args[idx + 1].trim().to_uppercase();
                    let clean = s.strip_prefix("SIG").unwrap_or(&s);
                    sig_num = match clean {
                        "KILL" | "9" => 9,
                        "INT" | "2" => 2,
                        "HUP" | "1" => 1,
                        "QUIT" | "3" => 3,
                        "ABRT" | "6" => 6,
                        "ALRM" | "14" => 14,
                        "TERM" | "15" => 15,
                        _ => clean.parse::<i32>().unwrap_or(15),
                    };
                }
                idx += 2;
            } else if let Some(rest) = a.strip_prefix("--signal=") {
                let s = rest.trim().to_uppercase();
                let clean = s.strip_prefix("SIG").unwrap_or(&s);
                sig_num = if clean == "KILL" || clean == "9" { 9 } else { 15 };
                idx += 1;
            } else {
                idx += 1;
            }
        }
        if has_kill_after {
            return Some(BuiltinOutcome {
                stdout: String::new(),
                stderr: "timeout: worker escalation cannot preserve finite shared interpreter quotas\n".to_string(),
                exit_code: 125,
            });
        }
        if idx + 1 < args.len() {
            let dur_s = parse_duration_seconds(&args[idx]);
            let sub_words = &args[idx + 1..];
            if sub_words.first().map(|s| s.as_str()) == Some("sleep")
                && let Some(sleep_arg) = sub_words.get(1)
            {
                let sleep_s = parse_duration_seconds(sleep_arg);
                if sleep_s > dur_s {
                    let code = if sig_num == 9 || preserve_status {
                        128 + sig_num
                    } else {
                        124
                    };
                    return Some(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: code,
                    });
                }
            }
            return Some(exec_sub(sub_words, stdin, cwd, env));
        }
        return Some(BuiltinOutcome {
            stdout: String::new(),
            stderr: "timeout: missing operand\n".to_string(),
            exit_code: 125,
        });
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

fn parse_duration_seconds(raw: &str) -> f64 {
    let s = raw.trim();
    if let Some(num) = s.strip_suffix('s') {
        num.parse::<f64>().unwrap_or(0.0)
    } else if let Some(num) = s.strip_suffix('m') {
        num.parse::<f64>().unwrap_or(0.0) * 60.0
    } else if let Some(num) = s.strip_suffix('h') {
        num.parse::<f64>().unwrap_or(0.0) * 3600.0
    } else if let Some(num) = s.strip_suffix('d') {
        num.parse::<f64>().unwrap_or(0.0) * 86400.0
    } else {
        s.parse::<f64>().unwrap_or(0.0)
    }
}
