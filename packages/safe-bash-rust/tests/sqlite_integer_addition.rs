use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn sqlite_integer_addition_preserves_all_64_bits_through_shell() {
    for (sql, expected) in [
        ("SELECT 9007199254740993+2;", "9007199254740995\n"),
        ("SELECT 9223372036854775806+1;", "9223372036854775807\n"),
        ("SELECT -9007199254740993+2;", "-9007199254740991\n"),
        (
            "SELECT -9223372036854775807+(-1);",
            "-9223372036854775808\n",
        ),
        ("SELECT 9007199254740993+2+2;", "9007199254740997\n"),
        ("SELECT 1.5+2,2+1.5;", "3.5|3.5\n"),
        (
            "CREATE TABLE t(n INTEGER); INSERT INTO t VALUES(9007199254740993); \
             SELECT n+2 FROM t; UPDATE t SET n=n+2; SELECT n FROM t; \
             SELECT n+count(*) FROM t GROUP BY n;",
            "9007199254740995\n9007199254740995\n9007199254740996\n",
        ),
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
                &format!("sqlite3 :memory: <<'INPUT'\n{sql}\nINPUT"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""), "{sql}");
        assert_eq!(result.stdout, expected, "{sql}");
        assert!(!result.used_typescript_bridge);
    }
}
use std::collections::BTreeMap;

#[test]
fn sqlite_addition_preserves_64_bit_integers() {
    for (sql, expected) in [
        ("SELECT 9007199254740993+2;", "9007199254740995\n"),
        ("SELECT 9223372036854775806+1;", "9223372036854775807\n"),
        (
            "CREATE TABLE counters(value INTEGER); INSERT INTO counters VALUES(9007199254740993); UPDATE counters SET value=value+2; SELECT value FROM counters;",
            "9007199254740995\n",
        ),
        ("SELECT 1.5+2;", "3.5\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: <<'INPUT'\n{sql}\nINPUT"),
                ExecOptions {
                    cwd: Some("/".into()),
                    env: BTreeMap::from([
                        ("LC_ALL".into(), "C".into()),
                        ("TZ".into(), "UTC".into()),
                    ]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{sql}");
        assert_eq!(result.stderr, "");
    }
}
