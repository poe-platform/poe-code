use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_limit_applies_offset_before_count() {
    for (clause, expected) in [
        ("1,2", "2\n3\n"),
        ("1, 2", "2\n3\n"),
        ("2 OFFSET 1", "2\n3\n"),
        ("0,2", "1\n2\n"),
        ("2,0", ""),
        ("9,2", ""),
        ("2,-1", "3\n4\n"),
        ("-1,2", "1\n2\n"),
        ("2", "1\n2\n"),
        ("-1", "1\n2\n3\n4\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(n); INSERT INTO t VALUES(1),(2),(3),(4); SELECT n FROM t ORDER BY n LIMIT {clause};\nINPUT"),
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
        assert_eq!(result.stdout, expected, "LIMIT {clause}");
        assert_eq!(result.stderr, "");
    }
}
