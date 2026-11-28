use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_orders_by_computed_source_keys() {
    for (query, expected) in [
        ("SELECT k FROM t ORDER BY n % 2 DESC,k", "2\n1\n3\n"),
        ("SELECT k FROM t ORDER BY -n,k", "3\n1\n2\n"),
        ("SELECT k FROM t ORDER BY n % 2 DESC,k LIMIT 1", "2\n"),
        (
            "SELECT k AS id FROM t ORDER BY n % 2 DESC,id DESC",
            "2\n3\n1\n",
        ),
        ("SELECT k FROM t ORDER BY n,k", "2\n1\n3\n"),
        (
            "SELECT k FROM t ORDER BY CAST(n % 2 AS INTEGER) DESC,k",
            "2\n1\n3\n",
        ),
        (
            "SELECT k FROM t ORDER BY nullif(n,2) DESC NULLS LAST,k",
            "3\n2\n1\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec_with_options(
            &format!("sqlite3 :memory: 'CREATE TABLE t(k,n);INSERT INTO t VALUES(1,2),(2,1),(3,4); {query};'"),
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
fn sqlite_orders_by_computed_keys_outside_projection() {
    for (query, expected) in [
        ("SELECT k FROM t ORDER BY n % 2 DESC,k", "2\n1\n3\n"),
        ("SELECT k FROM t ORDER BY n % 2,k DESC", "3\n1\n2\n"),
        ("SELECT k FROM t ORDER BY n % 2 DESC,k LIMIT 2", "2\n1\n"),
        ("SELECT k FROM t ORDER BY abs(n - 3),k DESC", "3\n1\n2\n"),
        (
            "SELECT k FROM t ORDER BY NULLIF(n % 2, 0) NULLS LAST,k DESC",
            "2\n3\n1\n",
        ),
        (
            "SELECT k FROM t ORDER BY CAST(n % 2 AS INTEGER) DESC,k",
            "2\n1\n3\n",
        ),
        ("SELECT k AS n FROM t ORDER BY n DESC", "3\n2\n1\n"),
        ("SELECT k FROM t ORDER BY n DESC", "3\n1\n2\n"),
        (
            "SELECT k,n % 2 AS parity FROM t ORDER BY parity DESC,k",
            "2|1\n1|0\n3|0\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: 'CREATE TABLE t(k,n);INSERT INTO t VALUES(1,2),(2,1),(3,4); {query};'"),
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
        assert_eq!(result.exit_code, 0, "{query}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{query}");
        assert!(!result.used_typescript_bridge, "{query}");
        assert_eq!(result.stdout, expected, "{query}");
    }
}
