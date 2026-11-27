use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn sqlite_group_by_keeps_composite_keys_independent_through_shell() {
    for (sql, expected) in [
        (
            "CREATE TABLE t(a,b); INSERT INTO t VALUES('a'||char(31)||'b','c'),('a','b'||char(31)||'c'); SELECT count(*) FROM t GROUP BY a,b;",
            "1\n1\n",
        ),
        (
            "CREATE TABLE t(a,b); INSERT INTO t VALUES('a'||char(31)||'b','c'),('a','b'||char(31)||'c'),('a','b'||char(31)||'c'); SELECT count(*) FROM t GROUP BY a,b ORDER BY count(*);",
            "1\n2\n",
        ),
        (
            "CREATE TABLE t(a,b); INSERT INTO t VALUES('',char(31)),(char(31),''); SELECT count(*) FROM t GROUP BY a,b;",
            "1\n1\n",
        ),
        (
            "CREATE TABLE t(a,b); INSERT INTO t VALUES('a'||char(31)||'b','c'),('a','b'||char(31)||'c'); SELECT a AS x,b AS y,count(*) FROM t GROUP BY x,y ORDER BY a,b;",
            "a|b\x1fc|1\na\x1fb|c|1\n",
        ),
        (
            "CREATE TABLE t(a,b); INSERT INTO t VALUES('a'||char(31)||'b','c'),('a','b'||char(31)||'c'); SELECT a,b,count(*) FROM t GROUP BY 1,2 ORDER BY a,b;",
            "a|b\x1fc|1\na\x1fb|c|1\n",
        ),
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
                &format!("sqlite3 :memory: <<'INPUT'\n{sql}\nINPUT"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""), "{sql}");
        assert_eq!(result.stdout, expected, "{sql}");
        assert!(!result.used_typescript_bridge);
    }
}

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
