use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn sqlite_concatenation_binds_more_tightly_than_arithmetic_through_shell() {
    for (sql, expected) in [
        ("SELECT 2 * 3 || '4';", "68\n"),
        (
            "SELECT 2 + 3 || '4', 40 - 3 || '4', 68 / 3 || '4', 70 % 3 || '4';",
            "36|6|2|2\n",
        ),
        ("SELECT '2' || 3 * 4, '2' || '3' + '4';", "92|27\n"),
        (
            "SELECT 2 * 3 || '4' || '5', NULL || '4', 'x' || NULL;",
            "690||\n",
        ),
        ("SELECT CASE WHEN 1 THEN 2 * 3 ELSE 0 END || '4';", "64\n"),
        ("SELECT (2 * 3) || '4', 2 * (3 || '4');", "64|68\n"),
        (
            "SELECT 'a+b' || 'c*d', '2' || -3, 2 * -3 || '4';",
            "a+bc*d|2-3|-68\n",
        ),
        ("SELECT abs(2) * 3 || '4', 2 * 3 || abs(4);", "68|68\n"),
        ("SELECT CASE WHEN 1 THEN 2 * 3 || '4' ELSE '0' END;", "68\n"),
        (
            "CREATE TABLE t(n INTEGER); INSERT INTO t VALUES(3); \
             SELECT 2 * n || '4' FROM t; \
             SELECT 2 * sum(n) || '4' FROM t; \
             UPDATE t SET n = 2 * n || '4'; SELECT n FROM t;",
            "68\n68\n68\n",
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
