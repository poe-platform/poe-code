use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_normalizes_timestamp_offsets_before_extracting_dates() {
    for (script, expected) in [
        (
            r#"sqlite3 :memory: 'SELECT date('"'"'2020-01-02T00:30:00+02:00'"'"');'"#,
            "2020-01-01\n",
        ),
        (
            "sqlite3 :memory: \"SELECT date('2020-01-01T00:30:00+02:00'),date('2020-12-31T23:30:00-02:00'),date('2020-03-01T00:15:00+00:30');\"",
            "2019-12-31|2021-01-01|2020-02-29\n",
        ),
        (
            "sqlite3 :memory: \"SELECT strftime('%Y-%m-%d %H:%M:%S','2020-01-02T00:30:45+02:15'),strftime('%Y-%m-%d %H:%M:%S','2020-01-02 23:30:45-00:45');\"",
            "2020-01-01 22:15:45|2020-01-03 00:15:45\n",
        ),
        (
            "sqlite3 :memory: \"SELECT date('2020-03-01T00:30:00+02:00','start of month'),date('2020-01-02T00:30:00+02:00','+1 day');\"",
            "2020-02-01|2020-01-02\n",
        ),
        (
            "sqlite3 :memory: \"SELECT strftime('%Y-%m-%d %H:%M:%S','2020-01-02T00:30:45Z'),strftime('%Y-%m-%d %H:%M:%S','2020-01-02T00:30:45+00:00'),date('2020-01-02');\"",
            "2020-01-02 00:30:45|2020-01-02 00:30:45|2020-01-02\n",
        ),
        (
            "sqlite3 :memory: \"SELECT date('2020-01-02T00:30+02:00'),strftime('%Y-%m-%d %H:%M:%S','2020-01-02T00:30:45.125+02:00');\"",
            "2020-01-01|2020-01-01 22:30:45\n",
        ),
        (
            "sqlite3 :memory: \"SELECT date('2020-01-02T00:30:00+15:00'),date('2020-01-02T00:30:00+02:60'),date('2020-01-02T00:30:00+02'),date('2020-01-02T00:30:00+aa:00');\"",
            "|||\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                script,
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
        assert_eq!(result.stdout, expected, "{script}");
        assert_eq!(result.stderr, "");
    }
}
