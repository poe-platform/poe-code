use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn jq_strftime_iso_week_dates() {
    for (input, expected) in [
        ("1609459200", "2020-W53-5"),
        ("1609632000", "2020-W53-7"),
        ("1609718400", "2021-W01-1"),
        ("1546214400", "2019-W01-1"),
        ("1640995200", "2021-W52-6"),
        ("1709164800", "2024-W09-4"),
        ("-259200", "1970-W01-1"),
        ("-1", "1970-W01-3"),
        ("1609459200|gmtime", "2020-W53-5"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let script = format!("printf %s 'null\n' | jq -c '{input}|strftime(\"%G-W%V-%u\")'");
        let result = shell
            .exec_with_options(
                &script,
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
        assert!(!result.used_typescript_bridge, "{input}");
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{input}");
        assert_eq!(result.stdout, format!("\"{expected}\"\n"), "{input}");
    }
}
