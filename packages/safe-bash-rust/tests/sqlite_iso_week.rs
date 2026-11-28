use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_strftime_iso_week_year() {
    for (date, expected) in [
        ("2021-01-01", "2020-W53"),
        ("2021-01-03", "2020-W53"),
        ("2021-01-04", "2021-W01"),
        ("2018-12-31", "2019-W01"),
        ("2016-01-01", "2015-W53"),
        ("2022-01-01", "2021-W52"),
        ("2024-02-29", "2024-W09"),
        ("1969-12-29", "1970-W01"),
        ("0099-01-01", "0099-W01"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: \"SELECT strftime('%G-W%V','{date}');\""),
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
        assert_eq!(result.exit_code, 0, "{date}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{date}");
        assert_eq!(result.stdout, format!("{expected}\n"), "{date}");
    }
}
