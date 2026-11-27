use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_orders_nulls_and_non_null_values() {
    for (query, expected) in [
        (
            "SELECT coalesce(n,99) FROM t ORDER BY n NULLS LAST",
            "1\n3\n99\n",
        ),
        (
            "SELECT coalesce(n,99) FROM t ORDER BY n DESC NULLS LAST",
            "3\n1\n99\n",
        ),
        (
            "SELECT coalesce(n,99) FROM t ORDER BY n ASC NULLS FIRST",
            "99\n1\n3\n",
        ),
        (
            "SELECT coalesce(n,99) FROM t ORDER BY n dEsC nUlLs FiRsT",
            "99\n3\n1\n",
        ),
        ("SELECT coalesce(n,99) FROM t ORDER BY n", "99\n1\n3\n"),
        ("SELECT coalesce(n,99) FROM t ORDER BY n DESC", "3\n1\n99\n"),
        (
            "SELECT n AS value FROM t ORDER BY value NULLS LAST",
            "1\n3\n\n",
        ),
        (
            "SELECT n, count(*) FROM t GROUP BY n ORDER BY n NULLS LAST",
            "1|1\n3|1\n|1\n",
        ),
        (
            "SELECT n, count(*) FROM t GROUP BY n ORDER BY n DESC NULLS FIRST",
            "|1\n3|1\n1|1\n",
        ),
        (
            "SELECT coalesce(n,99) FROM t ORDER BY n NULLS LAST LIMIT 2",
            "1\n3\n",
        ),
        (
            "SELECT n FROM t WHERE n IS NULL ORDER BY n NULLS LAST",
            "\n",
        ),
        ("SELECT n FROM t WHERE n = 2 ORDER BY n NULLS LAST", ""),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec_with_options(
            &format!("sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(n); INSERT INTO t VALUES(NULL),(3),(1); {query};\nINPUT"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        ).unwrap();
        assert_eq!(result.exit_code, 0, "{query}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{query}");
        assert_eq!(result.stderr, "", "{query}");
    }
}

#[test]
fn sqlite_null_order_keeps_empty_text_and_secondary_keys() {
    for group in ["", " GROUP BY n, label"] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "sqlite3 :memory: \"CREATE TABLE t(n, label); INSERT INTO t VALUES(NULL,'a'),('', 'empty'),(NULL,'z'),('b','text'),('a','first'); SELECT label FROM t{group} ORDER BY n NULLS LAST, label DESC;\""
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, "empty\nfirst\ntext\nz\na\n");
        assert_eq!(result.stderr, "");
    }
}
