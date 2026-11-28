use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_julianday_preserves_time_of_day() {
    for (script, expected) in [
        (
            r#"sqlite3 :memory: 'SELECT round((julianday('"'"'2000-01-01 12:00:00'"'"')-julianday('"'"'2000-01-01'"'"'))*24);'"#,
            "12.0\n",
        ),
        (
            r#"sqlite3 :memory: "SELECT julianday('2000-01-01'),julianday('2000-01-01 06:00:00'),julianday('2000-01-01 12:00:00');""#,
            "2451544.5|2451544.75|2451545.0\n",
        ),
        (
            r#"sqlite3 :memory: "SELECT round((julianday('2000-01-02 00:01:30')-julianday('2000-01-01 23:59:00'))*86400);""#,
            "150.0\n",
        ),
        (
            r#"sqlite3 :memory: "SELECT julianday('2000-01-01T14:00:00+02:00'),julianday('2000-01-01 06:00:00','+6 hours'),julianday('bad date'),julianday(NULL);""#,
            "2451545.0|2451545.0||\n",
        ),
        (
            r#"sqlite3 :memory: "CREATE TABLE events (ts TEXT); INSERT INTO events VALUES ('2000-01-01 18:00:00'); SELECT julianday(ts) FROM events;""#,
            "2451545.25\n",
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
