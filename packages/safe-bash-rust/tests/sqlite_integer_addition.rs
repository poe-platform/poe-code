use safe_bash_rust::{ExecOptions, Shell};
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
