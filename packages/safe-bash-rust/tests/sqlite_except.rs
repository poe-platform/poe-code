use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_except_removes_duplicate_survivors_through_shell() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "sqlite3 :memory: 'SELECT n FROM (SELECT 3 AS n UNION ALL SELECT 3) EXCEPT SELECT 2;'",
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "3\n");
    assert_eq!(result.stderr, "");
}

#[test]
fn sqlite_except_deduplicates_complete_rows_before_order_and_limit() {
    for (query, expected) in [
        ("SELECT a,b FROM t EXCEPT SELECT 9,9", "1|4\n2|5\n3|6\n"),
        (
            "SELECT a,b FROM t EXCEPT SELECT a,b FROM t WHERE a=9",
            "1|4\n2|5\n3|6\n",
        ),
        (
            "SELECT a,b FROM t EXCEPT SELECT a,b FROM t WHERE a=2",
            "1|4\n3|6\n",
        ),
        ("SELECT a,b FROM t EXCEPT SELECT a,b FROM t", ""),
        (
            "SELECT a,b FROM t EXCEPT SELECT 9,9 ORDER BY b DESC LIMIT 1 OFFSET 1",
            "2|5\n",
        ),
        (
            "SELECT a,b FROM t UNION ALL SELECT 9,9",
            "3|6\n1|4\n3|6\n2|5\n1|4\n9|9\n",
        ),
        ("SELECT a,b FROM t UNION SELECT 9,9", "1|4\n2|5\n3|6\n9|9\n"),
        ("SELECT a,b FROM t EXCEPT SELECT 1,5", "1|4\n2|5\n3|6\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "sqlite3 :memory: 'CREATE TABLE t(a,b); INSERT INTO t VALUES(3,6),(1,4),(3,6),(2,5),(1,4); {query};'"
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{query}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{query}");
        assert_eq!(result.stderr, "", "{query}");
    }
}
