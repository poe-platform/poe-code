use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

fn run_sql(sql: &str) -> String {
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
            &format!("sqlite3 :memory: <<'SQL'\n{sql}\nSQL"),
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""), "{sql}");
    assert!(!result.used_typescript_bridge);
    result.stdout
}

#[test]
fn sqlite_applies_bit_masks_to_each_row() {
    assert_eq!(
        run_sql(
            "CREATE TABLE t(k INTEGER PRIMARY KEY,n INT,tag TEXT); \
             INSERT INTO t VALUES(1,3,'a'),(2,1,'a'),(3,6,'b'),(4,1,'b'); \
             SELECT (n & 1) AS odd FROM t ORDER BY k;"
        ),
        "1\n1\n0\n1\n"
    );
}

#[test]
fn sqlite_bit_masks_preserve_integers_and_nulls() {
    for (sql, expected) in [
        (
            "SELECT 9007199254740993 & 1, -1 & 3, 9223372036854775807 & -2;",
            "1|3|9223372036854775806\n",
        ),
        ("SELECT 3.9 & 1, -3.9 & 3, '3' & 1, 'abc' & 1;", "1|1|1|0\n"),
        ("SELECT NULL & 1, 1 & NULL, typeof(3 & 1);", "||integer\n"),
        (
            "SELECT 6 & 1 + 2, 6 + 1 & 3, 7 & 3 & 1, 7 & -2, 7 & +3;",
            "2|3|1|6|3\n",
        ),
        (
            "SELECT 'a&b', 7 & (1+2), CASE WHEN 1 THEN 3 & 1 ELSE 0 END, 7 & 1 || '0';",
            "a&b|3|1|2\n",
        ),
    ] {
        assert_eq!(run_sql(sql), expected, "{sql}");
    }
}

#[test]
fn sqlite_bit_masks_work_in_filters_updates_and_aggregates() {
    assert_eq!(
        run_sql(
            "CREATE TABLE t(n); INSERT INTO t VALUES(3),(6); \
             SELECT n FROM t WHERE (n & 1)=1; \
             SELECT (sum(n) & 1),sum(n & 1),sum(n) & NULL FROM t; \
             UPDATE t SET n=n & 1; SELECT n FROM t ORDER BY rowid;"
        ),
        "3\n1|1|\n1\n0\n"
    );
}
