pub mod builtins;
pub mod eval;
pub mod expand;
pub mod lexer;
pub mod parser;

use crate::backend::{BackendMode, HybridBackend, RustCommand};
use crate::budget::ShellLimits;
use crate::fs::{MemoryVfs, SafeBashFs, normalize_posix_path};
use std::collections::BTreeMap;
use std::sync::Arc;

#[derive(Clone, Default)]
pub struct ShellOptions {
    pub cwd: Option<String>,
    pub env: BTreeMap<String, String>,
    pub mode: BackendMode,
}

#[derive(Clone, Default)]
pub struct ExecOptions {
    pub cwd: Option<String>,
    pub stdin: Option<String>,
    pub timeout_ms: Option<u64>,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub cwd: String,
    pub used_typescript_bridge: bool,
}

pub struct Shell {
    fs: Arc<dyn SafeBashFs>,
    cwd: String,
    env: BTreeMap<String, String>,
    backend: HybridBackend,
    limits: ShellLimits,
}

impl Shell {
    pub fn new(fs: Arc<dyn SafeBashFs>, options: ShellOptions) -> Self {
        let cwd = options
            .cwd
            .as_deref()
            .map(normalize_posix_path)
            .unwrap_or_else(|| "/".to_string());
        let _ = fs.mkdir_all(&cwd);
        Self {
            fs,
            cwd,
            env: options.env,
            backend: HybridBackend::new(options.mode),
            limits: ShellLimits::default(),
        }
    }

    pub fn with_memory_fs() -> (Self, MemoryVfs) {
        let vfs = MemoryVfs::new();
        let shell = Self::new(Arc::new(vfs.clone()), ShellOptions::default());
        (shell, vfs)
    }

    pub fn set_limits(&mut self, limits: ShellLimits) {
        self.limits = limits;
    }

    pub fn limits(&self) -> &ShellLimits {
        &self.limits
    }

    pub fn register_command(&mut self, name: impl Into<String>, cmd: RustCommand) {
        self.backend.register_command(name, cmd);
    }

    pub fn cwd(&self) -> &str {
        &self.cwd
    }

    pub fn env(&self) -> &BTreeMap<String, String> {
        &self.env
    }

    pub fn fs(&self) -> &Arc<dyn SafeBashFs> {
        &self.fs
    }

    pub fn exec(&mut self, script: &str) -> Result<ExecOutput, String> {
        self.exec_with_options(script, ExecOptions::default())
    }

    pub fn exec_with_options(
        &mut self,
        script: &str,
        options: ExecOptions,
    ) -> Result<ExecOutput, String> {
        if let Some(override_cwd) = options.cwd.as_deref() {
            self.cwd = normalize_posix_path(override_cwd);
        }
        for (k, v) in options.env {
            self.env.insert(k, v);
        }
        let stdin = options.stdin.as_deref().unwrap_or("");

        if self.backend.mode != BackendMode::TypeScriptOnly
            && let Some(native_res) = self.backend.try_execute_native_with_limits(
                script,
                &mut self.cwd,
                &mut self.env,
                stdin,
                options.timeout_ms,
                &self.limits,
                self.fs.as_ref(),
            )
        {
            let res = native_res?;
            return Ok(ExecOutput {
                stdout: res.stdout,
                stderr: res.stderr,
                exit_code: res.exit_code,
                cwd: self.cwd.clone(),
                used_typescript_bridge: false,
            });
        }

        if self.backend.mode == BackendMode::NativeOnly {
            return Err("Command requires TypeScript safe-bash bridge, but BackendMode::NativeOnly is set".into());
        }

        let res = self.backend.execute_typescript_bridge(
            script,
            &mut self.cwd,
            &mut self.env,
            stdin,
            options.timeout_ms,
            self.fs.as_ref(),
        )?;
        Ok(ExecOutput {
            stdout: res.stdout,
            stderr: res.stderr,
            exit_code: res.exit_code,
            cwd: self.cwd.clone(),
            used_typescript_bridge: true,
        })
    }
}
