use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_composite_group_keys_keep_column_boundaries() {
    for (values, expected) in [
        (
            "('a'||char(31)||'b','c'),('a','b'||char(31)||'c')",
            "1\n1\n",
        ),
        (
            "('a'||char(31)||'b','c'),('a','b'||char(31)||'c'),('a','b'||char(31)||'c')",
            "2\n1\n",
        ),
        ("('',char(31)),(char(31),'')", "1\n1\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(a,b); INSERT INTO t VALUES{values}; SELECT count(*) FROM t GROUP BY a,b;\nINPUT"),
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
        assert_eq!(result.stdout, expected, "{values}");
        assert_eq!(result.stderr, "");
    }
}
