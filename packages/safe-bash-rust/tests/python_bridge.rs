use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn failed_python_does_not_replay_prior_shell_writes() {
    let fs = MemoryVfs::new();
    fs.mkdir_all("/work").unwrap();
    let mut shell = Shell::new(Arc::new(fs.clone()), ShellOptions {
        cwd: Some("/work".into()), mode: BackendMode::Hybrid, ..Default::default()
    });
    shell.exec("printf once >> visits; python3 -c 'raise SystemExit(7)'").unwrap();
    assert_eq!(fs.read_file("/work/visits").unwrap(), b"once");
}

#[test]
#[ignore = "requires SAFE_BASH_PYODIDE_MODULE_URL pointing to installed Pyodide 314.0.6"]
fn configured_pyodide_shares_virtual_files_and_is_discoverable() {
    assert!(!std::env::var("SAFE_BASH_PYODIDE_MODULE_URL").unwrap().is_empty());
    let fs = MemoryVfs::new();
    fs.mkdir_all("/work").unwrap();
    fs.write_file("/work/input.txt", b"hello").unwrap();
    let mut shell = Shell::new(Arc::new(fs.clone()), ShellOptions {
        cwd: Some("/work".into()), mode: BackendMode::Hybrid, ..Default::default()
    });
    assert_eq!(shell.exec("command -v python python3").unwrap().exit_code, 0);
    let result = shell.exec("python3 -c 'import sys; assert sys.platform == \"emscripten\"; open(\"output.txt\",\"w\").write(open(\"input.txt\").read().upper())'").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert!(result.used_typescript_bridge);
    assert_eq!(fs.read_file("/work/output.txt").unwrap(), b"HELLO");
    assert_eq!(shell.exec("/usr/bin/python -c 'raise SystemExit(7)'").unwrap().exit_code, 7);
}
