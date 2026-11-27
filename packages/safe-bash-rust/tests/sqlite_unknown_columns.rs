use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn sqlite_rejects_unknown_projection_columns_without_rows() {
    for setup in ["", "INSERT INTO t VALUES(7);"] {
        for query in [
            "SELECT missing FROM t",
            "SELECT missing AS report FROM t",
            "SELECT n, missing FROM t",
            "SELECT DISTINCT missing FROM t",
            "SELECT t.missing FROM t",
            "SELECT `missing` FROM t",
            "SELECT [missing] FROM t",
            "SELECT missing FROM t WHERE n < 0",
            "SELECT missing FROM t LIMIT 0",
        ] {
            let mut shell = Shell::new(
                Arc::new(MemoryVfs::new()),
                ShellOptions {
                    cwd: Some("/".into()),
                    env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                    mode: BackendMode::NativeOnly,
                },
            );
            let result = shell
                .exec_with_options(
                    &format!(
                        "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(n); {setup} {query};\nINPUT\n"
                    ),
                    ExecOptions::default(),
                )
                .unwrap();
            assert_eq!(result.exit_code, 1, "{setup} {query}: {result:?}");
            assert_eq!(result.stdout, "", "{query}");
            assert!(
                result.stderr.contains("no such column:"),
                "{query}: {}",
                result.stderr
            );
            assert!(result.stderr.contains("missing"), "{}", result.stderr);
            assert!(!result.used_typescript_bridge);
        }
    }
}

#[test]
fn sqlite_unknown_column_preserves_stored_data() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let setup = shell
        .exec("sqlite3 /data.db 'CREATE TABLE t(n); INSERT INTO t VALUES(7);'")
        .unwrap();
    assert_eq!(setup.exit_code, 0, "{}", setup.stderr);
    let rejected = shell
        .exec("sqlite3 /data.db 'SELECT missing FROM t WHERE n < 0;'")
        .unwrap();
    assert_eq!(rejected.exit_code, 1, "{rejected:?}");
    let preserved = shell.exec("sqlite3 /data.db 'SELECT n FROM t;'").unwrap();
    assert_eq!(
        (
            preserved.exit_code,
            preserved.stdout.as_str(),
            preserved.stderr.as_str()
        ),
        (0, "7\n", "")
    );
}

#[test]
fn sqlite_unknown_column_preserves_writes_from_the_same_command() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let rejected = shell
        .exec("sqlite3 /data.db 'CREATE TABLE t(n); INSERT INTO t VALUES(7); SELECT missing FROM t WHERE n < 0;'")
        .unwrap();
    assert_eq!(rejected.exit_code, 1, "{rejected:?}");
    assert_eq!(rejected.stdout, "");
    assert!(rejected.stderr.contains("no such column: missing"));
    let preserved = shell.exec("sqlite3 /data.db 'SELECT n FROM t;'").unwrap();
    assert_eq!(
        (
            preserved.exit_code,
            preserved.stdout.as_str(),
            preserved.stderr.as_str()
        ),
        (0, "7\n", "")
    );
}

#[test]
fn sqlite_valid_projections_still_accept_empty_and_populated_tables() {
    for (setup, expected) in [
        ("", ""),
        (
            "INSERT INTO t VALUES(7);",
            "7|7|7|7|missing|missing||12|1.5\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let result = shell.exec(&format!("sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(n); {setup} SELECT n, N AS report, t.n, [n], 'missing', \"missing\", NULL, 12, 1.5 FROM t;\nINPUT\n")).unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
        assert_eq!(result.stdout, expected);
    }
}
