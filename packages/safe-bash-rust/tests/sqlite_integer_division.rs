use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_integer_division_truncates_toward_zero() {
    for (sql, expected) in [
        ("SELECT 7/2, -7/2;", "3|-3\n"),
        ("SELECT 7/(-2), (-7)/(-2);", "-3|3\n"),
        ("SELECT 7.0/2, 7/2.0;", "3.5|3.5\n"),
        ("SELECT 9223372036854775807/3;", "3074457345618258602\n"),
        (
            "CREATE TABLE t(n INTEGER); INSERT INTO t VALUES(7),(-7); SELECT n/2 FROM t;",
            "3\n-3\n",
        ),
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
