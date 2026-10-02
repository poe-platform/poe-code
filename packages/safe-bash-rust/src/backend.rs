use crate::fs::{SafeBashFs, VfsEntryKind, VfsFileEntry, resolve_posix_path};
use mcp_protocol_rust::json::{Limits, Value, parse, stringify};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BackendMode {
    #[default]
    Hybrid,
    NativeOnly,
    TypeScriptOnly,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub cwd: String,
    pub env: BTreeMap<String, String>,
}

pub struct CommandContext<'a> {
    pub args: &'a [String],
    pub stdin: &'a str,
    pub cwd: &'a mut String,
    pub env: &'a mut BTreeMap<String, String>,
    pub fs: &'a dyn SafeBashFs,
}

pub type RustCommand =
    Arc<dyn Fn(&mut CommandContext<'_>) -> Result<CommandResult, String> + Send + Sync>;

#[derive(Default)]
pub struct HybridBackend {
    pub mode: BackendMode,
    commands: BTreeMap<String, RustCommand>,
}

#[derive(Debug)]
struct ParsedRedirect {
    target: String,
    append: bool,
}

#[derive(Debug)]
struct SimpleSegment {
    words: Vec<String>,
    redirect_out: Option<ParsedRedirect>,
}

fn jstr(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn from_jstr(u: &[u16]) -> String {
    String::from_utf16_lossy(u)
}

fn obj_get<'a>(props: &'a [(Vec<u16>, Value)], key: &str) -> Option<&'a Value> {
    let key_u16 = jstr(key);
    props.iter().find_map(|(k, v)| (k == &key_u16).then_some(v))
}

impl HybridBackend {
    pub fn new(mode: BackendMode) -> Self {
        Self {
            mode,
            commands: BTreeMap::new(),
        }
    }

    pub fn register_command(&mut self, name: impl Into<String>, cmd: RustCommand) {
        self.commands.insert(name.into(), cmd);
    }

    pub fn try_execute_native(
        &self,
        script: &str,
        cwd: &mut String,
        env: &mut BTreeMap<String, String>,
        stdin: &str,
        fs: &dyn SafeBashFs,
    ) -> Option<Result<CommandResult, String>> {
        let segments = parse_simple_and_chain(script)?;
        let mut combined_stdout = String::new();
        let mut combined_stderr = String::new();
        let mut last_exit = 0;

        for seg in segments {
            if seg.words.is_empty() {
                continue;
            }
            let cmd_name = &seg.words[0];
            let args = &seg.words[1..];

            let seg_result = if let Some(custom) = self.commands.get(cmd_name) {
                let mut ctx = CommandContext {
                    args,
                    stdin,
                    cwd,
                    env,
                    fs,
                };
                match custom(&mut ctx) {
                    Ok(res) => {
                        *cwd = res.cwd.clone();
                        *env = res.env.clone();
                        res
                    }
                    Err(err) => return Some(Err(err)),
                }
            } else {
                execute_builtin(cmd_name, args, stdin, cwd, env, fs)?
            };

            last_exit = seg_result.exit_code;
            combined_stderr.push_str(&seg_result.stderr);

            if let Some(redir) = seg.redirect_out {
                let out_path = resolve_posix_path(cwd, &redir.target);
                let payload = if redir.append && fs.exists(&out_path) {
                    let mut existing = fs.read_file(&out_path).unwrap_or_default();
                    existing.extend_from_slice(seg_result.stdout.as_bytes());
                    existing
                } else {
                    seg_result.stdout.as_bytes().to_vec()
                };
                if let Err(err) = fs.write_file(&out_path, &payload) {
                    return Some(Err(err));
                }
            } else {
                combined_stdout.push_str(&seg_result.stdout);
            }

            if last_exit != 0 {
                break;
            }
        }

        Some(Ok(CommandResult {
            stdout: combined_stdout,
            stderr: combined_stderr,
            exit_code: last_exit,
            cwd: cwd.clone(),
            env: env.clone(),
        }))
    }

    pub fn execute_typescript_bridge(
        &self,
        script: &str,
        cwd: &mut String,
        env: &mut BTreeMap<String, String>,
        stdin: &str,
        timeout_ms: Option<u64>,
        fs: &dyn SafeBashFs,
    ) -> Result<CommandResult, String> {
        let entries = fs.export_entries()?;
        let mut files_json = Vec::with_capacity(entries.len());
        for entry in entries {
            let kind_str = match entry.kind {
                VfsEntryKind::File => "file",
                VfsEntryKind::Directory => "directory",
                VfsEntryKind::Symlink => "symlink",
            };
            let mut obj = vec![
                (jstr("path"), Value::String(jstr(&entry.path))),
                (jstr("kind"), Value::String(jstr(kind_str))),
                (
                    jstr("dataBase64"),
                    Value::String(jstr(&base64_encode(&entry.data))),
                ),
                (jstr("mode"), Value::Number(entry.mode as f64)),
            ];
            if let Some(target) = entry.symlink_target {
                obj.push((jstr("symlinkTarget"), Value::String(jstr(&target))));
            }
            files_json.push(Value::Object(obj));
        }

        let mut env_obj = Vec::with_capacity(env.len());
        for (k, v) in env.iter() {
            env_obj.push((jstr(k), Value::String(jstr(v))));
        }

        let mut req_obj = vec![
            (jstr("script"), Value::String(jstr(script))),
            (jstr("cwd"), Value::String(jstr(cwd))),
            (jstr("env"), Value::Object(env_obj)),
            (jstr("stdin"), Value::String(jstr(stdin))),
            (jstr("files"), Value::Array(files_json)),
        ];
        if let Some(ms) = timeout_ms {
            req_obj.push((jstr("timeoutMs"), Value::Number(ms as f64)));
        }

        let payload = stringify(&Value::Object(req_obj));
        let runner_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("bridge")
            .join("runner.mjs");

        let mut child = Command::new("node")
            .arg(&runner_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn safe-bash TypeScript bridge: {e}"))?;

        if let Some(mut child_stdin) = child.stdin.take() {
            child_stdin
                .write_all(payload.as_bytes())
                .map_err(|e| format!("Failed writing to bridge stdin: {e}"))?;
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("Failed waiting for safe-bash bridge: {e}"))?;

        if !output.status.success() {
            let stderr_text = String::from_utf8_lossy(&output.stderr);
            return Err(format!("safe-bash bridge failed: {stderr_text}"));
        }

        let parsed = parse(
            &output.stdout,
            Limits {
                max_bytes: 64 * 1024 * 1024,
                max_depth: 128,
                max_nodes: 1_048_576,
            },
        )
            .map_err(|e| format!("Invalid JSON from safe-bash bridge: {e:?}"))?;

        let Value::Object(resp) = parsed else {
            return Err("Expected JSON object from safe-bash bridge".into());
        };

        if let Some(Value::Bool(true)) = obj_get(&resp, "timedOut") {
            return Err("Command timed out".into());
        }

        let out_stdout = match obj_get(&resp, "stdout") {
            Some(Value::String(s)) => from_jstr(s),
            _ => String::new(),
        };
        let out_stderr = match obj_get(&resp, "stderr") {
            Some(Value::String(s)) => from_jstr(s),
            _ => String::new(),
        };
        let exit_code = match obj_get(&resp, "exitCode") {
            Some(Value::Number(n)) => *n as i32,
            _ => 0,
        };
        if let Some(Value::String(next_cwd)) = obj_get(&resp, "cwd") {
            *cwd = from_jstr(next_cwd);
        }
        if let Some(Value::Object(next_env)) = obj_get(&resp, "env") {
            env.clear();
            for (k, v) in next_env {
                if let Value::String(s) = v {
                    env.insert(from_jstr(k), from_jstr(s));
                }
            }
        }

        if let Some(Value::Array(files)) = obj_get(&resp, "files") {
            let mut synced = Vec::with_capacity(files.len());
            for item in files {
                if let Value::Object(f) = item {
                    let Some(Value::String(path)) = obj_get(f, "path") else {
                        continue;
                    };
                    let kind = match obj_get(f, "kind") {
                        Some(Value::String(k)) => match from_jstr(k).as_str() {
                            "directory" => VfsEntryKind::Directory,
                            "symlink" => VfsEntryKind::Symlink,
                            _ => VfsEntryKind::File,
                        },
                        _ => VfsEntryKind::File,
                    };
                    let symlink_target = match obj_get(f, "symlinkTarget") {
                        Some(Value::String(t)) => Some(from_jstr(t)),
                        _ => None,
                    };
                    let bytes = match obj_get(f, "dataBase64") {
                        Some(Value::String(b64)) => base64_decode(&from_jstr(b64))?,
                        _ => Vec::new(),
                    };
                    let mode = match obj_get(f, "mode") {
                        Some(Value::Number(m)) => *m as u32,
                        _ => 0o100644,
                    };
                    synced.push(VfsFileEntry {
                        path: from_jstr(path),
                        kind,
                        data: bytes,
                        symlink_target,
                        mode,
                    });
                }
            }
            fs.replace_entries(&synced)?;
        }

        Ok(CommandResult {
            stdout: out_stdout,
            stderr: out_stderr,
            exit_code,
            cwd: cwd.clone(),
            env: env.clone(),
        })
    }
}

fn execute_builtin(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> Option<CommandResult> {
    match cmd {
        "pwd" => Some(CommandResult {
            stdout: format!("{cwd}\n"),
            stderr: String::new(),
            exit_code: 0,
            cwd: cwd.clone(),
            env: env.clone(),
        }),
        "true" => Some(CommandResult {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
            cwd: cwd.clone(),
            env: env.clone(),
        }),
        "false" => Some(CommandResult {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
            cwd: cwd.clone(),
            env: env.clone(),
        }),
        "echo" => {
            let mut newline = true;
            let mut start = 0;
            if args.first().map(String::as_str) == Some("-n") {
                newline = false;
                start = 1;
            }
            let text = args[start..].join(" ");
            let stdout = if newline { format!("{text}\n") } else { text };
            Some(CommandResult {
                stdout,
                stderr: String::new(),
                exit_code: 0,
                cwd: cwd.clone(),
                env: env.clone(),
            })
        }
        "cd" => {
            let target = args.first().map(String::as_str).unwrap_or("/");
            let resolved = resolve_posix_path(cwd, target);
            if !fs.is_dir(&resolved) {
                return Some(CommandResult {
                    stdout: String::new(),
                    stderr: format!("cd: {target}: No such file or directory\n"),
                    exit_code: 1,
                    cwd: cwd.clone(),
                    env: env.clone(),
                });
            }
            *cwd = resolved;
            Some(CommandResult {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
                cwd: cwd.clone(),
                env: env.clone(),
            })
        }
        "mkdir" => {
            for arg in args.iter().filter(|a| !a.starts_with('-')) {
                let resolved = resolve_posix_path(cwd, arg);
                if let Err(err) = fs.mkdir_all(&resolved) {
                    return Some(CommandResult {
                        stdout: String::new(),
                        stderr: format!("mkdir: {err}\n"),
                        exit_code: 1,
                        cwd: cwd.clone(),
                        env: env.clone(),
                    });
                }
            }
            Some(CommandResult {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
                cwd: cwd.clone(),
                env: env.clone(),
            })
        }
        "cat" => {
            if args.is_empty() {
                return Some(CommandResult {
                    stdout: stdin.to_string(),
                    stderr: String::new(),
                    exit_code: 0,
                    cwd: cwd.clone(),
                    env: env.clone(),
                });
            }
            let mut out = String::new();
            for arg in args {
                if arg.starts_with('-') {
                    return None;
                }
                let resolved = resolve_posix_path(cwd, arg);
                match fs.read_file(&resolved) {
                    Ok(bytes) => out.push_str(&String::from_utf8_lossy(&bytes)),
                    Err(err) => {
                        return Some(CommandResult {
                            stdout: out,
                            stderr: format!("cat: {arg}: {err}\n"),
                            exit_code: 1,
                            cwd: cwd.clone(),
                            env: env.clone(),
                        });
                    }
                }
            }
            Some(CommandResult {
                stdout: out,
                stderr: String::new(),
                exit_code: 0,
                cwd: cwd.clone(),
                env: env.clone(),
            })
        }
        "touch" => {
            for arg in args.iter().filter(|a| !a.starts_with('-')) {
                let resolved = resolve_posix_path(cwd, arg);
                if !fs.exists(&resolved)
                    && let Err(err) = fs.write_file(&resolved, b"")
                {
                    return Some(CommandResult {
                        stdout: String::new(),
                        stderr: format!("touch: {err}\n"),
                        exit_code: 1,
                        cwd: cwd.clone(),
                        env: env.clone(),
                    });
                }
            }
            Some(CommandResult {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
                cwd: cwd.clone(),
                env: env.clone(),
            })
        }
        "rm" => {
            let force = args
                .iter()
                .any(|a| a == "-f" || a == "--force" || a == "-rf" || a == "-fr");
            let recursive = args
                .iter()
                .any(|a| a == "-r" || a == "-R" || a == "--recursive" || a == "-rf" || a == "-fr");
            if recursive {
                return None;
            }
            for arg in args.iter().filter(|a| !a.starts_with('-')) {
                let resolved = resolve_posix_path(cwd, arg);
                if !fs.exists(&resolved) {
                    if force {
                        continue;
                    }
                    return Some(CommandResult {
                        stdout: String::new(),
                        stderr: format!("rm: cannot remove '{arg}': No such file or directory\n"),
                        exit_code: 1,
                        cwd: cwd.clone(),
                        env: env.clone(),
                    });
                }
                if let Err(err) = fs.remove_path(&resolved) {
                    return Some(CommandResult {
                        stdout: String::new(),
                        stderr: format!("rm: {err}\n"),
                        exit_code: 1,
                        cwd: cwd.clone(),
                        env: env.clone(),
                    });
                }
            }
            Some(CommandResult {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
                cwd: cwd.clone(),
                env: env.clone(),
            })
        }
        "export" => {
            for arg in args {
                if let Some((k, v)) = arg.split_once('=') {
                    env.insert(k.to_string(), v.to_string());
                }
            }
            Some(CommandResult {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
                cwd: cwd.clone(),
                env: env.clone(),
            })
        }
        _ => None,
    }
}

fn parse_simple_and_chain(script: &str) -> Option<Vec<SimpleSegment>> {
    let trimmed = script.trim();
    if trimmed.is_empty() {
        return Some(vec![]);
    }
    // Delegate scripts with newlines, subshells, variables, loops, pipes, or globs to TypeScript safe-bash
    if trimmed.contains('\n')
        || trimmed.contains('$')
        || trimmed.contains('`')
        || trimmed.contains('|')
        || trimmed.contains(';')
        || trimmed.contains('(')
        || trimmed.contains(')')
        || trimmed.contains('{')
        || trimmed.contains('}')
        || trimmed.contains('*')
        || trimmed.contains('?')
        || trimmed.contains('<')
    {
        return None;
    }

    let mut segments = Vec::new();
    for raw_part in trimmed.split("&&") {
        let tokens = tokenize_simple_words(raw_part.trim())?;
        if tokens.is_empty() {
            return None;
        }
        let mut words = Vec::new();
        let mut redirect_out = None;
        let mut i = 0;
        while i < tokens.len() {
            if tokens[i] == ">" || tokens[i] == ">>" {
                let append = tokens[i] == ">>";
                let target = tokens.get(i + 1)?.clone();
                redirect_out = Some(ParsedRedirect { target, append });
                i += 2;
            } else if tokens[i].contains('>') {
                return None;
            } else {
                words.push(tokens[i].clone());
                i += 1;
            }
        }
        if words.is_empty() {
            return None;
        }
        segments.push(SimpleSegment {
            words,
            redirect_out,
        });
    }
    Some(segments)
}

fn tokenize_simple_words(input: &str) -> Option<Vec<String>> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if in_single {
            if ch == '\'' {
                in_single = false;
            } else {
                current.push(ch);
            }
        } else if in_double {
            if ch == '"' {
                in_double = false;
            } else if ch == '\\' {
                let next = chars.next()?;
                current.push(next);
            } else {
                current.push(ch);
            }
        } else {
            match ch {
                '\'' => in_single = true,
                '"' => in_double = true,
                ' ' | '\t' => {
                    if !current.is_empty() {
                        tokens.push(std::mem::take(&mut current));
                    }
                }
                '>' => {
                    if !current.is_empty() {
                        tokens.push(std::mem::take(&mut current));
                    }
                    if chars.peek() == Some(&'>') {
                        chars.next();
                        tokens.push(">>".to_string());
                    } else {
                        tokens.push(">".to_string());
                    }
                }
                '\\' => {
                    let next = chars.next()?;
                    current.push(next);
                }
                other => current.push(other),
            }
        }
    }

    if in_single || in_double {
        return None;
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Some(tokens)
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(BASE64_ALPHABET[((triple >> 18) & 0x3F) as usize] as char);
        out.push(BASE64_ALPHABET[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(BASE64_ALPHABET[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(BASE64_ALPHABET[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn base64_val(b: u8) -> Option<u32> {
    match b {
        b'A'..=b'Z' => Some((b - b'A') as u32),
        b'a'..=b'z' => Some((b - b'a' + 26) as u32),
        b'0'..=b'9' => Some((b - b'0' + 52) as u32),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    let bytes: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    if !bytes.len().is_multiple_of(4) {
        return Err("Invalid base64 length".into());
    }
    let mut out = Vec::with_capacity((bytes.len() / 4) * 3);
    for chunk in bytes.chunks(4) {
        let c0 = base64_val(chunk[0]).ok_or("Invalid base64 char")?;
        let c1 = base64_val(chunk[1]).ok_or("Invalid base64 char")?;
        let c2 = if chunk[2] == b'=' {
            0
        } else {
            base64_val(chunk[2]).ok_or("Invalid base64 char")?
        };
        let c3 = if chunk[3] == b'=' {
            0
        } else {
            base64_val(chunk[3]).ok_or("Invalid base64 char")?
        };
        let triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
        out.push(((triple >> 16) & 0xFF) as u8);
        if chunk[2] != b'=' {
            out.push(((triple >> 8) & 0xFF) as u8);
        }
        if chunk[3] != b'=' {
            out.push((triple & 0xFF) as u8);
        }
    }
    Ok(out)
}
