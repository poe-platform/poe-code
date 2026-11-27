use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_weekday_advances_to_requested_day() {
    for (sql, expected) in [
        ("SELECT date('2024-01-01','weekday 5');", "2024-01-05\n"),
        ("SELECT date('2024-01-05','weekday 5');", "2024-01-05\n"),
        ("SELECT date('2024-01-06','weekday 5');", "2024-01-12\n"),
        ("SELECT date('2024-01-01','weekday 0');", "2024-01-07\n"),
        ("SELECT date('2024-01-01','weekday 6');", "2024-01-06\n"),
        ("SELECT date('2024-02-28','weekday 4');", "2024-02-29\n"),
        ("SELECT date('2023-02-28','weekday 3');", "2023-03-01\n"),
        ("SELECT date('2023-12-31','weekday 1');", "2024-01-01\n"),
        ("SELECT date('1969-12-31','weekday 4');", "1970-01-01\n"),
        (
            "SELECT date('2024-01-31','+1 day','weekday 1','+1 day');",
            "2024-02-06\n",
        ),
        (
            "SELECT strftime('%Y-%m-%d %H:%M:%S','2024-01-01 12:34:56','weekday 5');",
            "2024-01-05 12:34:56\n",
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
