use crate::budget::{ExecutionBudget, ShellLimits};
use crate::fs::{SafeBashFs, VfsEntryKind, VfsFileEntry};
use crate::vfs::FileStat;
use crate::shell::eval::{EvalError, EvalState};
use crate::shell::parser::Script;
use mcp_protocol_rust::json::{Limits, Value, parse, stringify};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

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
    functions: Mutex<BTreeMap<String, Script>>,
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

struct BudgetedFs<'a> {
    inner: &'a dyn SafeBashFs,
    budget: &'a ExecutionBudget,
}

impl<'a> BudgetedFs<'a> {
    fn check_path(&self, path: &str) -> Result<(), String> {
        let comps = path.split('/').filter(|s| !s.is_empty()).count();
        if comps > self.budget.limits.max_pathname_components {
            return Err("ENAMETOOLONG: File name too long".to_string());
        }
        Ok(())
    }
}

impl<'a> SafeBashFs for BudgetedFs<'a> {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        self.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.read_file(path)
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        self.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.budget.add_output_bytes(data.len())?;
        self.inner.write_file(path, data)
    }

    fn append_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        self.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.budget.add_output_bytes(data.len())?;
        self.inner.append_file(path, data)
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        self.check_path(path)?;
        self.inner.remove_path(path)
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        self.check_path(path)?;
        self.inner.mkdir_all(path)
    }

    fn exists(&self, path: &str) -> bool {
        self.inner.exists(path)
    }

    fn is_dir(&self, path: &str) -> bool {
        self.inner.is_dir(path)
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        self.inner.list_dir(path)
    }

    fn symlink(&self, target: &str, path: &str) -> Result<(), String> {
        self.check_path(path)?;
        self.inner.symlink(target, path)
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        self.inner.readlink(path)
    }

    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> {
        self.inner.export_entries()
    }

    fn replace_entries(&self, entries: &[VfsFileEntry]) -> Result<(), String> {
        self.inner.replace_entries(entries)
    }

    fn stat(&self, path: &str) -> Result<FileStat, String> {
        self.inner.stat(path)
    }

    fn lstat(&self, path: &str) -> Result<FileStat, String> {
        self.inner.lstat(path)
    }

    fn chmod(&self, path: &str, mode: u32) -> Result<(), String> {
        self.inner.chmod(path, mode)
    }

    fn set_mtime(&self, path: &str, mtime_ms: u64) -> Result<(), String> {
        self.inner.set_mtime(path, mtime_ms)
    }

    fn generation(&self) -> u64 {
        self.inner.generation()
    }
}

impl HybridBackend {
    pub fn new(mode: BackendMode) -> Self {
        Self {
            mode,
            commands: BTreeMap::new(),
            functions: Mutex::new(BTreeMap::new()),
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
        self.try_execute_native_with_limits(
            script,
            cwd,
            env,
            stdin,
            None,
            &ShellLimits::default(),
            fs,
        )
    }

    pub fn try_execute_native_with_limits(
        &self,
        script: &str,
        cwd: &mut String,
        env: &mut BTreeMap<String, String>,
        stdin: &str,
        timeout_ms: Option<u64>,
        limits: &ShellLimits,
        fs: &dyn SafeBashFs,
    ) -> Option<Result<CommandResult, String>> {
        if script != ":" {
            crate::commands::reset_virtual_clock();
        }
        let budget = ExecutionBudget::new(limits.clone(), timeout_ms);
        let budgeted_fs = BudgetedFs {
            inner: fs,
            budget: &budget,
        };
        let allow_fallback = self.mode == BackendMode::Hybrid;
        let mut eval = EvalState::new(cwd, env, &budgeted_fs, &budget, &self.commands, allow_fallback);
        if let Ok(guard) = self.functions.lock() {
            eval.functions = guard.clone();
        }
        let eval_res = eval.eval_script_str(script, stdin);
        if let Err(exceeded_msg) = budget.check_exceeded() {
            return Some(Err(exceeded_msg));
        }
        match eval_res {
            Ok(res) => {
                let last_exit_str = res.exit_code.to_string();
                if let Ok(mut guard) = self.functions.lock() {
                    *guard = eval.functions;
                }
                if script != ":" {
                    env.insert("__last_exit".to_string(), last_exit_str);
                }
                Some(Ok(res))
            }
            Err(EvalError::Syntax(msg)) => Some(Ok(CommandResult {
                stdout: String::new(),
                stderr: format!("syntax error: {msg}\n"),
                exit_code: 2,
                cwd: cwd.clone(),
                env: env.clone(),
            })),
            Err(EvalError::Budget(msg)) => Some(Err(msg)),
            Err(EvalError::UnportedCommand(_)) => None,
        }
    }

    #[cfg(target_arch = "wasm32")]
    pub fn execute_typescript_bridge(
        &self,
        _script: &str,
        _cwd: &mut String,
        _env: &mut BTreeMap<String, String>,
        _stdin: &str,
        _timeout_ms: Option<u64>,
        _fs: &dyn SafeBashFs,
    ) -> Result<CommandResult, String> {
        let _ = (jstr, from_jstr, obj_get, base64_encode, base64_decode);
        let _ = (Limits::default, Value::Null, parse, stringify, VfsEntryKind::File, VfsFileEntry {
            path: String::new(),
            kind: VfsEntryKind::File,
            data: Vec::new(),
            symlink_target: None,
            mode: 0,
        });
        Err("TypeScript subprocess bridge is not available on wasm32".into())
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn execute_typescript_bridge(
        &self,
        script: &str,
        cwd: &mut String,
        env: &mut BTreeMap<String, String>,
        stdin: &str,
        timeout_ms: Option<u64>,
        fs: &dyn SafeBashFs,
    ) -> Result<CommandResult, String> {
        use std::io::Write;
        use std::path::PathBuf;
        use std::process::{Command, Stdio};

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
