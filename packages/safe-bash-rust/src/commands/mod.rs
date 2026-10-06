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
        let mut overrides = Vec::new();
        while idx < args.len() {
            let a = &args[idx];
            if a == "-i" || a == "--ignore-environment" {
                ignore_env = true;
                idx += 1;
            } else if a == "-u" && idx + 1 < args.len() {
                idx += 2;
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
        if idx < args.len() {
            let mut sub_env = if ignore_env {
                BTreeMap::new()
            } else {
                env.clone()
            };
            for (k, v) in overrides {
                sub_env.insert(k, v);
            }
            return Some(exec_sub(&args[idx..], stdin, cwd, &mut sub_env));
        }
    }

    if cmd == "timeout" && args.len() >= 2 {
        let mut idx = 0usize;
        while idx < args.len() && args[idx].starts_with('-') {
            idx += 1;
        }
        if idx + 1 < args.len() {
            return Some(exec_sub(&args[idx + 1..], stdin, cwd, env));
        }
    }

    if let Some(res) = coreutils::try_run_coreutil(cmd, args, stdin, cwd, env, fs) {
        return Some(res);
    }
    if let Some(res) = fs::try_run_fs_command(cmd, args, cwd, fs) {
        return Some(res);
    }
    if let Some(res) = search::try_run_search_command(cmd, args, stdin, cwd, env, fs, exec_sub) {
        return Some(res);
    }
    if let Some(res) = text::try_run_text_command(cmd, args, stdin, cwd, fs) {
        return Some(res);
    }
    if let Some(res) = structured::try_run_structured_command(cmd, args, stdin, cwd, env, fs) {
        return Some(res);
    }
    if let Some(res) = archive::try_run_archive_command(cmd, args, stdin, cwd, fs) {
        return Some(res);
    }
    None
}
