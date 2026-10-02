use crate::fs::{SafeBashFs, normalize_posix_path, resolve_posix_path};
use crate::shell::{ExecOptions, Shell, ShellOptions};
use poe_agent_rust::shell_tools::{RetainedOutput, timeout_ms, validate_policy};
use std::collections::BTreeMap;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellMode {
    Read,
    Edit,
}

impl ShellMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ShellMode::Read => "read",
            ShellMode::Edit => "edit",
        }
    }
}

#[derive(Clone, Default)]
pub struct PoeAgentShellOptions {
    pub cwd: Option<String>,
    pub allowed_paths: Vec<String>,
    pub shell: ShellOptions,
}

#[derive(Clone, Default)]
pub struct AgentRunCommandRequest {
    pub command: String,
    pub cwd: Option<String>,
    pub timeout_seconds: Option<f64>,
    pub run_in_background: bool,
    pub mode: Option<ShellMode>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackgroundStatus {
    pub handle: String,
    pub status: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub formatted: String,
}

pub struct PoeAgentShellHost {
    shell: Shell,
    default_cwd: String,
    allowed_paths: Vec<String>,
    background_jobs: BTreeMap<String, BackgroundStatus>,
    next_handle: usize,
}

impl PoeAgentShellHost {
    pub fn new(fs: Arc<dyn SafeBashFs>, options: PoeAgentShellOptions) -> Self {
        let default_cwd = options
            .cwd
            .as_deref()
            .or(options.shell.cwd.as_deref())
            .map(normalize_posix_path)
            .unwrap_or_else(|| "/".to_string());
        let allowed_paths = if options.allowed_paths.is_empty() {
            vec![default_cwd.clone()]
        } else {
            options
                .allowed_paths
                .iter()
                .map(|p| resolve_posix_path(&default_cwd, p))
                .collect()
        };
        let mut shell_opts = options.shell;
        shell_opts.cwd = Some(default_cwd.clone());
        let shell = Shell::new(fs, shell_opts);
        Self {
            shell,
            default_cwd,
            allowed_paths,
            background_jobs: BTreeMap::new(),
            next_handle: 0,
        }
    }

    pub fn shell_mut(&mut self) -> &mut Shell {
        &mut self.shell
    }

    fn resolve_allowed_cwd(&self, requested: Option<&str>) -> Result<String, String> {
        let resolved = match requested {
            Some(path) => resolve_posix_path(&self.default_cwd, path),
            None => self.shell.cwd().to_string(),
        };
        let allowed = self.allowed_paths.iter().any(|root| {
            resolved == *root || resolved.starts_with(&format!("{root}/")) || root == "/"
        });
        if !allowed {
            return Err(format!(
                "Working directory \"{resolved}\" is outside allowed paths"
            ));
        }
        Ok(resolved)
    }

    pub fn run_command(&mut self, req: AgentRunCommandRequest) -> Result<String, String> {
        let timeout_ms_f64 = timeout_ms(req.timeout_seconds).map_err(|e| e.to_string())?;
        let mode = req.mode.unwrap_or(ShellMode::Edit);
        let cmd_utf16: Vec<u16> = req.command.encode_utf16().collect();
        if let Some(rejection) = validate_policy(&cmd_utf16, mode.as_str()) {
            return Err(String::from_utf16_lossy(&rejection));
        }

        let effective_cwd = self.resolve_allowed_cwd(req.cwd.as_deref())?;
        let exec_res = self.shell.exec_with_options(
            &req.command,
            ExecOptions {
                cwd: Some(effective_cwd),
                timeout_ms: Some(timeout_ms_f64 as u64),
                ..Default::default()
            },
        )?;

        if self.resolve_allowed_cwd(Some(self.shell.cwd())).is_err() {
            let _ = self.shell.exec_with_options(
                "true",
                ExecOptions {
                    cwd: Some(self.default_cwd.clone()),
                    ..Default::default()
                },
            );
        }

        let formatted_stdout = retain_utf16_output(&exec_res.stdout);
        let formatted_stderr = retain_utf16_output(&exec_res.stderr);
        let combined = combine_streams(&formatted_stdout, &formatted_stderr);

        if req.run_in_background {
            self.next_handle += 1;
            let handle = format!("background-{}", self.next_handle);
            let formatted = format!(
                "Handle: {handle}\nStatus: exited\nExit code: {}\nStdout:\n{}\nStderr:\n{}",
                exec_res.exit_code,
                if formatted_stdout.trim().is_empty() {
                    "(empty)"
                } else {
                    formatted_stdout.trim()
                },
                if formatted_stderr.trim().is_empty() {
                    "(empty)"
                } else {
                    formatted_stderr.trim()
                },
            );
            self.background_jobs.insert(
                handle.clone(),
                BackgroundStatus {
                    handle: handle.clone(),
                    status: "exited".to_string(),
                    exit_code: Some(exec_res.exit_code),
                    stdout: formatted_stdout,
                    stderr: formatted_stderr,
                    formatted,
                },
            );
            return Ok(handle);
        }

        if exec_res.exit_code != 0 {
            if combined.is_empty() {
                return Err(format!("Command failed with exit code {}", exec_res.exit_code));
            }
            return Err(format!("Command failed: {combined}"));
        }

        Ok(combined)
    }

    pub fn read_background(&mut self, handle: &str) -> Result<BackgroundStatus, String> {
        self.background_jobs
            .get(handle)
            .cloned()
            .ok_or_else(|| format!("Unknown background command handle: {handle}"))
    }

    pub fn kill_background(&mut self, handle: &str) -> Result<String, String> {
        if !self.background_jobs.contains_key(handle) {
            return Err(format!("Unknown background command handle: {handle}"));
        }
        Ok(format!("Background command {handle} has already exited."))
    }
}

fn retain_utf16_output(text: &str) -> String {
    let mut retained = RetainedOutput::default();
    let units: Vec<u16> = text.encode_utf16().collect();
    retained.append(&units);
    String::from_utf16_lossy(&retained.format())
}

fn combine_streams(stdout: &str, stderr: &str) -> String {
    let out_trimmed = stdout.trim();
    let err_trimmed = stderr.trim();
    match (out_trimmed.is_empty(), err_trimmed.is_empty()) {
        (true, true) => String::new(),
        (false, true) => out_trimmed.to_string(),
        (true, false) => err_trimmed.to_string(),
        (false, false) => format!("{out_trimmed}\n{err_trimmed}"),
    }
}
