use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn sqlite_limit_comma_applies_offset_before_count_through_shell() {
    for (query, expected) in [
        ("SELECT n FROM t ORDER BY n LIMIT 1,2", "2\n3\n"),
        ("SELECT n FROM t ORDER BY n LIMIT 1 , 2", "2\n3\n"),
        ("SELECT n FROM t ORDER BY n LIMIT 2 OFFSET 1", "2\n3\n"),
        ("SELECT n FROM t ORDER BY n LIMIT 2", "1\n2\n"),
        ("SELECT n FROM t ORDER BY n LIMIT 0,2", "1\n2\n"),
        ("SELECT n FROM t ORDER BY n LIMIT 2,0", ""),
        ("SELECT n FROM t ORDER BY n LIMIT 4,2", ""),
        ("SELECT n FROM t ORDER BY n LIMIT 1,-1", "2\n3\n4\n"),
        ("SELECT n FROM t ORDER BY n LIMIT -1,2", "1\n2\n"),
        ("SELECT n FROM t ORDER BY n DESC LIMIT 1,2", "3\n2\n"),
        ("SELECT n FROM t WHERE n > 1 ORDER BY n LIMIT 1,2", "3\n4\n"),
        (
            "SELECT n FROM t UNION ALL SELECT n FROM t ORDER BY n LIMIT 1,2",
            "1\n2\n",
        ),
        (
            "SELECT n FROM t UNION SELECT n FROM t ORDER BY n LIMIT 2 OFFSET 1",
            "2\n3\n",
        ),
        (
            "SELECT n, count(*) FROM t GROUP BY n ORDER BY n LIMIT 1,2",
            "2|1\n3|1\n",
        ),
        ("SELECT count(*) FROM t LIMIT 1,2", ""),
    ] {
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
                &format!("sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(n); INSERT INTO t VALUES(1),(2),(3),(4); {query};\nINPUT"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(
            (result.exit_code, result.stderr.as_str()),
            (0, ""),
            "{query}"
        );
        assert_eq!(result.stdout, expected, "{query}");
        assert!(!result.used_typescript_bridge);
    }
}

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
