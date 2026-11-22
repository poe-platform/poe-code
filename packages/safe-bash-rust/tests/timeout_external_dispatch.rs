use safe_bash_rust::{BackendMode, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn timeout_resolves_external_commands_and_preserves_child_status() {
    for duration in ["0", "1s"] {
        for (script, exit_code, stdout) in [
            (
                format!("myfn() {{ printf intercepted; }}; timeout {duration} myfn"),
                127,
                "",
            ),
            (
                format!("myfn() {{ printf intercepted; }}; export -f myfn; timeout {duration} myfn"),
                127,
                "",
            ),
            (
                format!("echo() {{ printf intercepted; }}; timeout {duration} echo expected"),
                0,
                "expected\n",
            ),
            (format!("timeout {duration} sh -c 'exit 7'"), 7, ""),
            (
                format!("echo() {{ printf intercepted; }}; timeout {duration} echo expected; echo"),
                0,
                "expected\nintercepted",
            ),
            (
                format!(
                    "myfn() {{ printf exported; }}; export -f myfn; timeout {duration} sh -c myfn"
                ),
                0,
                "exported",
            ),
        ] {
            let mut shell = Shell::new(
                Arc::new(MemoryVfs::new()),
                ShellOptions {
                    mode: BackendMode::NativeOnly,
                    ..Default::default()
                },
            );
            let result = shell.exec(&script).unwrap();
            assert_eq!(result.exit_code, exit_code, "{script}: {}", result.stderr);
            assert_eq!(result.stdout, stdout, "{script}");
            if exit_code == 127 {
                assert!(
                    result.stderr.contains("myfn: command not found"),
                    "{script}: {}",
                    result.stderr
                );
            } else {
                assert_eq!(result.stderr, "", "{script}");
            }
        }
    }
}

#[test]
fn external_plugin_invocations_import_functions_only_inside_a_shell() {
    use safe_bash_rust::{CommandResult, InvokeOptions};
    let (mut shell, _) = Shell::with_memory_fs();
    shell.register_command("driver", Arc::new(|ctx| {
        let direct = ctx.invoke("f", &[], InvokeOptions { external_invocation: true, ..Default::default() }, &mut String::new())?;
        assert_eq!((direct.exit_code, direct.stdout.as_str()), (127, ""));
        let imported = ctx.invoke("bash", &["--noprofile".into(), "--norc".into(), "-c".into(), "f".into()], InvokeOptions { external_invocation: true, ..Default::default() }, &mut String::new())?;
        assert_eq!((imported.exit_code, imported.stdout.as_str(), imported.stderr.as_str()), (0, "inherited\n", ""));
        Ok(CommandResult { stdout: imported.stdout, stderr: imported.stderr, exit_code: imported.exit_code, env: ctx.env.clone(), cwd: ctx.cwd.clone() })
    }));
    let result = shell.exec("f(){ echo inherited; }; export -f f; driver").unwrap();
    assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, "inherited\n", ""));
}
