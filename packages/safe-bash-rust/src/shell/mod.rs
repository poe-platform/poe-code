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

/// The environment seen by commands excludes shell storage and non-exported bindings.
pub(crate) fn is_exported_scalar(env: &BTreeMap<String, String>, key: &str) -> bool {
    if key.contains(['\0', '[']) || matches!(key, "!" | "0")
        || env.contains_key(&format!("\0unexported__{key}"))
        || env.contains_key(&format!("\0keys__{key}"))
        || env.contains_key(&format!("\0assoc__{key}")) {
        return false;
    }
    match key {
        "PIPESTATUS" | "BASH_REMATCH" | "DIRSTACK" | "FUNCNAME" | "BASH_SOURCE" | "BASH_LINENO" => false,
        "BASH_SUBSHELL" | "BASH_COMMAND" => env.get(&format!("\0attr__{key}")).is_some_and(|s| s.contains('x')),
        _ => true,
    }
}

#[derive(Clone, Default)]
pub struct ShellOptions {
    pub cwd: Option<String>,
    pub env: BTreeMap<String, String>,
    pub mode: BackendMode,
}

#[derive(Clone, Default)]
pub struct ExecOptions {
    /// Filesystem for this execution only. Defaults to the shell’s filesystem.
    pub fs: Option<Arc<dyn SafeBashFs>>,
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

#[derive(Clone)]
pub struct Shell {
    pub(crate) fs: Arc<dyn SafeBashFs>,
    cwd: String,
    env: BTreeMap<String, String>,
    pub(crate) backend: HybridBackend,
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
        let mut env = options.env;
        // Internal bindings start with NUL, which cannot occur in an environment name.
        env.retain(|key, _| !key.contains('\0'));
        for value in env.values_mut() {
            if let std::borrow::Cow::Owned(quoted) = crate::vfs::shell_text(value) { *value = quoted; }
        }
        if !env.contains_key("IFS") {
            env.insert("IFS".into(), " \t\n".into());
            env.insert("\0unexported__IFS".into(), "1".into());
        }
        Self {
            fs,
            cwd,
            env,
            backend: HybridBackend::new(options.mode),
            limits: ShellLimits::default(),
        }
    }

    pub fn with_memory_fs() -> (Self, MemoryVfs) {
        let vfs = MemoryVfs::new();
        let shell = Self::new(Arc::new(vfs.clone()), ShellOptions::default());
        (shell, vfs)
    }

    /// Preserve the supplied filesystem's device paths when redirecting descriptors.
    pub fn use_provided_devices(&mut self) {
        self.backend.provided_devices = true;
    }

    pub fn set_limits(&mut self, limits: ShellLimits) {
        self.limits = limits;
    }

    pub fn limits(&self) -> &ShellLimits {
        &self.limits
    }

    /// Intercept command dispatch, including shell functions and nested invocations.
    pub fn set_middleware(&mut self, handler: RustCommand) {
        self.backend.middleware = Some(handler);
    }

    pub fn register_command(&mut self, name: impl Into<String>, cmd: RustCommand) {
        self.backend.register_command(name, cmd);
    }

    pub(crate) fn session_snapshot(&self, status: i32) -> String {
        self.backend.snapshot(&self.cwd, &self.env, status)
    }

    pub(crate) fn restore_session(&mut self, snapshot: &[u8]) -> Result<(), String> {
        self.cwd = self.backend.restore(snapshot, &mut self.env, &self.limits)?;
        Ok(())
    }

    pub fn cwd(&self) -> &str {
        &self.cwd
    }

    pub fn set_cwd(&mut self, cwd: &str) {
        let norm = normalize_posix_path(cwd);
        self.cwd = norm.clone();
        self.env.insert("PWD".to_string(), crate::vfs::shell_text(&norm).into_owned());
    }

    pub fn set_env(&mut self, key: &str, val: &str) {
        if key.contains('\0') { return; }
        self.set_binding(key, val);
    }

    pub(crate) fn set_binding(&mut self, key: &str, val: &str) {
        self.env.remove(&format!("\0unexported__{key}"));
        self.env.insert(key.to_string(), crate::vfs::shell_text(val).into_owned());
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
        self.exec_input(script, options, None)
    }

    /// Execute with a forward-only native stdin. A consumed iterator cannot be replayed in the bridge.
    pub fn exec_with_stream(
        &mut self,
        script: &str,
        mut chunks: impl Iterator<Item = Result<Vec<u8>, String>> + 'static,
    ) -> Result<ExecOutput, String> {
        self.exec_input(script, ExecOptions::default(), Some(eval::FdTarget::input_stream(false, move |_| chunks.next())))
    }

    pub(crate) fn exec_input(
        &mut self,
        script: &str,
        options: ExecOptions,
        stream: Option<eval::FdTarget>,
    ) -> Result<ExecOutput, String> {
        if stream.is_some() && self.backend.mode == BackendMode::TypeScriptOnly {
            return Err("Streamed stdin requires the native backend".into());
        }
        if let Some(override_cwd) = options.cwd.as_deref() {
            self.cwd = normalize_posix_path(override_cwd);
        }
        for (k, v) in options.env {
            self.set_env(&k, &v);
        }
        let stdin = options.stdin.as_deref();
        let fs = options.fs.as_deref().unwrap_or(self.fs.as_ref());

        if self.backend.mode != BackendMode::TypeScriptOnly
            && let Some(native_res) = self.backend.execute_native_input(
                script,
                &mut self.cwd,
                &mut self.env,
                stdin,
                stream,
                options.timeout_ms,
                &self.limits,
                fs,
            )
        {
            let mut res = native_res?;
            // A character may span writes. Decode the captured bytes together while
            // preserving the shell representation for arbitrary bytes and private-use text.
            for stream in [&mut res.stdout, &mut res.stderr] {
                if let Ok(std::borrow::Cow::Owned(text)) = crate::vfs::stream_utf8(stream) {
                    *stream = match crate::vfs::shell_text(&text) {
                        std::borrow::Cow::Owned(quoted) => quoted,
                        std::borrow::Cow::Borrowed(_) => text,
                    };
                }
            }
            return Ok(ExecOutput {
                stdout: res.stdout,
                stderr: res.stderr,
                exit_code: res.exit_code,
                cwd: self.cwd.clone(),
                used_typescript_bridge: self.backend.used_typescript_bridge.load(std::sync::atomic::Ordering::Relaxed),
            });
        }

        if self.backend.mode == BackendMode::NativeOnly {
            return Err("Command requires TypeScript safe-bash bridge, but BackendMode::NativeOnly is set".into());
        }

        let res = self.backend.execute_typescript_bridge(
            script,
            &mut self.cwd,
            &mut self.env,
            stdin.unwrap_or(""),
            options.timeout_ms,
            fs,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streamed_execution_uses_session_bindings_limits_and_the_live_filesystem() {
        let (mut shell, fs) = Shell::with_memory_fs();
        shell.exec("f() { head -c1; }; set -- saved").unwrap();
        let observed = fs.clone();
        let mut reads = 0;
        let chunks = std::iter::from_fn(move || {
            reads += 1;
            assert_eq!(reads, 1, "an early consumer pulled another chunk");
            assert_eq!(observed.read_file("/events").unwrap(), b"once\n");
            Some(Ok(b"abc".to_vec()))
        });
        let result = shell.exec_with_stream("echo once >> /events; f; keep=$1; sleep 2; echo $SECONDS", chunks).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.used_typescript_bridge), (0, "a2\n", false));
        assert_eq!(shell.exec("echo $keep").unwrap().stdout, "saved\n");
        assert_eq!(fs.read_file("/events").unwrap(), b"once\n");
        shell.set_limits(ShellLimits { max_input_bytes: 1, ..Default::default() });
        let err = shell.exec_with_stream("f", std::iter::once(Ok(vec![0, 1]))).unwrap_err();
        assert!(err.contains("maxInputBytes"), "{err}");
    }

    #[test]
    fn captured_output_reassembles_text_split_across_writes_without_losing_raw_bytes() {
        let (mut shell, _) = Shell::with_memory_fs();
        for cmd in ["tee", "tee >&2"] {
            for bytes in ["界".as_bytes(), "\u{e080}".as_bytes(), &[0xff, 0x80]] {
                let pieces: Vec<_> = bytes.iter().map(|&b| Ok(vec![b])).collect();
                let r = shell.exec_with_stream(cmd, pieces.into_iter()).unwrap();
                let output = if cmd == "tee" { r.stdout } else { r.stderr };
                assert_eq!(output, crate::vfs::bytes_to_stream_string(bytes));
            }
        }
    }

    #[test]
    fn streamed_execution_never_replays_the_script_or_input_in_the_bridge() {
        let fs = Arc::new(MemoryVfs::new());
        let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::Hybrid, ..Default::default() });
        let result = shell.exec_with_stream("cat >> /events; no-such-command", std::iter::once(Ok(vec![b'x']))).unwrap();
        assert_eq!((result.exit_code, result.used_typescript_bridge), (127, false));
        assert_eq!(fs.read_file("/events").unwrap(), b"x");
        let mut bridge = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::TypeScriptOnly, ..Default::default() });
        assert!(bridge.exec_with_stream("echo bad >> /events", std::iter::from_fn(|| panic!("unexpected pull"))).is_err());
        assert_eq!(fs.read_file("/events").unwrap(), b"x");
    }

    #[test]
    fn per_call_filesystem_owns_reads_writes_and_failures() {
        let (mut shell, default_fs) = Shell::with_memory_fs();
        let external = Arc::new(MemoryVfs::new());
        default_fs.write_file("/input", b"default").unwrap();
        external.write_file("/input", b"external").unwrap();
        let out = shell.exec_with_options(
            "cat /input | tee /copy; cat /missing",
            ExecOptions { fs: Some(external.clone()), ..Default::default() },
        ).unwrap();
        assert_eq!((out.exit_code, out.stdout.as_str(), out.used_typescript_bridge), (1, "external", false));
        assert_eq!(external.read_file("/copy").unwrap(), b"external");
        assert!(!default_fs.exists("/copy"));
        assert_eq!(shell.exec("cat /input").unwrap().stdout, "default");
    }

    #[test]
    fn noexec_prevents_writes_on_later_shell_turns() {
        let (mut shell, fs) = Shell::with_memory_fs();
        shell.exec("set -n").unwrap();
        let result = shell.exec("echo data > /should-not-exist").unwrap();
        assert_eq!(result.exit_code, 0);
        assert!(!fs.exists("/should-not-exist"));
    }

    #[test]
    fn positional_arguments_and_exported_functions_survive_shell_turns() {
        let (mut shell, _) = Shell::with_memory_fs();
        shell.exec("set -- alpha 'two words'; f() { echo child; }; export -f f").unwrap();
        let second = shell.exec("echo \"$#:$2\"; bash -c f").unwrap();
        assert_eq!((second.exit_code, second.stdout.as_str()), (0, "2:two words\nchild\n"));
        shell.exec("shift; export -n -f f").unwrap();
        let fourth = shell.exec("echo \"$#:$1\"; bash -c 'type -t f'").unwrap();
        assert_eq!((fourth.exit_code, fourth.stdout.as_str()), (1, "1:two words\n"));
    }

    #[test]
    fn unit_shell_with_memory_fs_exec_options_and_limits() {
        let (mut shell, vfs) = Shell::with_memory_fs();
        vfs.mkdir_all("/app").unwrap();
        let mut custom_limits = ShellLimits::default();
        custom_limits.max_loop_iterations = 250;
        shell.set_limits(custom_limits);
        assert_eq!(shell.limits().max_loop_iterations, 250);

        let mut env = BTreeMap::new();
        env.insert("GREETING".into(), "hello".into());
        let res = shell
            .exec_with_options(
                "read line; echo \"$GREETING:$line:$(pwd)\"",
                ExecOptions {
                    cwd: Some("/app".into()),
                    stdin: Some("world\n".into()),
                    timeout_ms: Some(1000),
                    env,
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(res.exit_code, 0);
        assert_eq!(res.stdout, "hello:world:/app\n");
        assert_eq!(shell.cwd(), "/app");
        assert_eq!(shell.env().get("GREETING").map(|s| s.as_str()), Some("hello"));
    }

    #[test]
    fn unit_shell_traps_namerefs_arrays_and_subshell_isolation() {
        let (mut shell, _vfs) = Shell::with_memory_fs();
        let res = shell
            .exec(
                r#"
                declare -A map=([k1]="v1" [k2]="v2")
                declare -n ref=map
                (ref[k1]="subshell_only")
                echo "${ref[k1]}:${ref[k2]}:${#map[@]}"
                "#,
            )
            .unwrap();
        assert_eq!(res.exit_code, 0);
        assert_eq!(res.stdout, "v1:v2:2\n");
    }

    #[test]
    fn unit_shell_pipefail_pipestatus_and_getopts() {
        let (mut shell, _vfs) = Shell::with_memory_fs();
        let res = shell
            .exec(
                r#"
                set -o pipefail
                sh -c 'exit 2' | sh -c 'exit 0' | sh -c 'exit 5'
                echo "rc=$? pipe=${PIPESTATUS[*]}"
                "#,
            )
            .unwrap();
        assert_eq!(res.exit_code, 0);
        assert_eq!(res.stdout, "rc=5 pipe=2 0 5\n");
    }

    #[test]
    fn unit_shell_persists_cwd_and_env_across_exec_calls() {
        let (mut shell, vfs) = Shell::with_memory_fs();
        vfs.mkdir_all("/workspace/proj").unwrap();
        shell.exec("cd /workspace/proj && export BUILD_ID=42").unwrap();
        let res = shell.exec("printf '%s:%s' \"$(pwd)\" \"$BUILD_ID\"").unwrap();
        assert_eq!(res.exit_code, 0);
        assert_eq!(res.stdout, "/workspace/proj:42");
    }

    #[test]
    fn unit_native_ls_rejects_unimplemented_long_listings() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        vfs.write_file("/work/file.txt", b"twelve bytes").unwrap();
        let mut shell = Shell::new(Arc::new(vfs), ShellOptions {
            cwd: Some("/work".into()), mode: BackendMode::NativeOnly,
            ..Default::default()
        });
        for flags in ["-l", "-la", "-ld", "-lh", "-g", "-o", "-n"] {
            let result = shell.exec(&format!("ls {flags} file.txt")).unwrap();
            assert_ne!(result.exit_code, 0, "{flags} silently discarded metadata");
            assert!(result.stdout.is_empty());
            assert!(result.stderr.contains("requires the TypeScript safe-bash bridge"));
        }
    }

    #[test]
    fn unit_native_ls_keeps_plain_listings_and_option_terminators() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        vfs.write_file("/work/-l", b"literal filename").unwrap();
        let mut shell = Shell::new(Arc::new(vfs), ShellOptions {
            cwd: Some("/work".into()), mode: BackendMode::NativeOnly,
            ..Default::default()
        });
        let result = shell.exec("ls -- -l").unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, "-l\n");
        let result = shell.exec("ls -a").unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, "-l\n.\n..\n");
    }

}
