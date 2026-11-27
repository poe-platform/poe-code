use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_invalid_dates_return_null() {
    for (expression, expected) in [
        ("coalesce(date('unknown'),'missing')", "missing\n"),
        ("coalesce(date(''),'missing')", "missing\n"),
        ("coalesce(date('2026-no-01'),'missing')", "missing\n"),
        ("coalesce(date('2026-13-01'),'missing')", "missing\n"),
        ("coalesce(date('2026-01-32'),'missing')", "missing\n"),
        ("coalesce(date(NULL),'missing')", "missing\n"),
        (
            "coalesce(date('unknown','start of month'),'missing')",
            "missing\n",
        ),
        ("coalesce(strftime('%Y', 'unknown'),'missing')", "missing\n"),
        ("date('2026-01-31','+1 day')", "2026-02-01\n"),
        (
            "strftime('%Y-%m-%d %H:%M:%S','2026-01-31T23:59:59')",
            "2026-01-31 23:59:59\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: <<'INPUT'\nSELECT {expression};\nINPUT"),
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
        assert_eq!(result.stdout, expected, "{expression}");
        assert_eq!(result.stderr, "");
    }
}
