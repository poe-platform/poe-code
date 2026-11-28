use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

fn shell() -> Shell {
    Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            mode: BackendMode::NativeOnly,
        },
    )
}

#[test]
fn sqlite_abs_rejects_minimum_signed_integer_through_shell() {
    let result = shell().exec_with_options(
        r#"sqlite3 :memory: 'CREATE TABLE t(k INTEGER PRIMARY KEY,n INT,tag TEXT); INSERT INTO t VALUES(1,3,'"'"'a'"'"'),(2,1,'"'"'a'"'"'),(3,6,'"'"'b'"'"'),(4,1,'"'"'b'"'"'); SELECT abs(-9223372036854775808);'"#,
        ExecOptions::default(),
    ).unwrap();
    assert_eq!(result.exit_code, 1, "{result:?}");
    assert_eq!(result.stdout, "");
    assert_eq!(result.stderr, "Error: stepping, integer overflow\n");
    assert!(!result.used_typescript_bridge);
}

#[test]
fn sqlite_abs_overflow_propagates_from_rows_and_nested_expressions() {
    for query in [
        "SELECT abs(n) FROM t;",
        "SELECT abs(n)+1 FROM t;",
        "SELECT coalesce(abs(n),0) FROM t;",
        "SELECT n FROM t WHERE abs(n)>0;",
        "SELECT (SELECT abs(n) FROM t);",
        "SELECT n FROM t LIMIT abs(-9223372036854775808);",
    ] {
        let result = shell().exec_with_options(
            "sqlite3 :memory:",
            ExecOptions {
                stdin: Some(format!("CREATE TABLE t(n INTEGER); INSERT INTO t VALUES(-9223372036854775808); {query}")),
                ..Default::default()
            },
        ).unwrap();
        assert_eq!(result.exit_code, 1, "{query}: {result:?}");
        assert_eq!(result.stdout, "", "{query}");
        assert_eq!(
            result.stderr, "Error: stepping, integer overflow\n",
            "{query}"
        );
    }
}

#[test]
fn sqlite_abs_preserves_representable_integer_boundaries() {
    let result = shell().exec_with_options(
        "sqlite3 :memory: 'SELECT abs(-9223372036854775807), abs(9223372036854775807), abs(-9007199254740993), abs(-1), abs(0), abs(1), abs(-1.5);'",
        ExecOptions::default(),
    ).unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    assert_eq!(
        result.stdout,
        "9223372036854775807|9223372036854775807|9007199254740993|1|0|1|1.5\n"
    );
}

#[test]
fn sqlite_abs_does_not_apply_integer_overflow_to_real_or_text_values() {
    for value in [
        "-9223372036854775808.0",
        "-9.223372036854776e18",
        "'-9223372036854775808'",
    ] {
        let result = shell()
            .exec_with_options(
                "sqlite3 :memory:",
                ExecOptions {
                    stdin: Some(format!("SELECT abs({value});")),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            (result.exit_code, result.stderr.as_str()),
            (0, ""),
            "{value}"
        );
        assert_eq!(
            result.stdout.trim().parse::<f64>().unwrap(),
            9223372036854775808.0
        );
    }
}

#[test]
fn sqlite_abs_overflow_preserves_preceding_writes_and_rolls_back_the_update() {
    let mut shell = shell();
    let result = shell.exec_with_options(
        "sqlite3 /abs.db 'CREATE TABLE t(n INTEGER); INSERT INTO t VALUES(-7),(-9223372036854775808); UPDATE t SET n=abs(n);'",
        ExecOptions::default(),
    ).unwrap();
    assert_eq!(result.exit_code, 1, "{result:?}");
    assert_eq!(result.stdout, "");
    assert_eq!(result.stderr, "Error: stepping, integer overflow\n");
    let result = shell.exec("sqlite3 /abs.db 'SELECT n FROM t;'").unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    assert_eq!(result.stdout, "-7\n-9223372036854775808\n");
}
