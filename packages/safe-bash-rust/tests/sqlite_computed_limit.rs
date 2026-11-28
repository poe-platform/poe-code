use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_computed_limit() {
    for (query, expected) in [
        (
            "SELECT k FROM t ORDER BY k LIMIT (SELECT count(*)-2 FROM t)",
            "1\n2\n",
        ),
        ("SELECT k FROM t ORDER BY k LIMIT 1+1", "1\n2\n"),
        (
            "SELECT k FROM t ORDER BY k LIMIT 2 OFFSET (SELECT count(*)-2 FROM t)",
            "3\n4\n",
        ),
        (
            "SELECT k FROM t ORDER BY k LIMIT (SELECT count(*)-2 FROM t), 1+1",
            "3\n4\n",
        ),
        (
            "SELECT k FROM t UNION SELECT k FROM t LIMIT (SELECT count(*)-2 FROM t)",
            "1\n2\n",
        ),
        (
            "SELECT tag FROM t GROUP BY tag ORDER BY tag LIMIT (SELECT count(*)-3 FROM t)",
            "a\n",
        ),
        (
            "SELECT k FROM t ORDER BY k LIMIT (SELECT 2 FROM t LIMIT 1 OFFSET 1)",
            "1\n2\n",
        ),
        ("SELECT k FROM t ORDER BY k LIMIT 0", ""),
        (
            "SELECT k FROM t ORDER BY k LIMIT -1 OFFSET -1",
            "1\n2\n3\n4\n",
        ),
        ("SELECT k FROM t ORDER BY k LIMIT 2 OFFSET 1", "2\n3\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec_with_options(
            &format!("sqlite3 :memory: \"CREATE TABLE t(k INTEGER PRIMARY KEY,n INT,tag TEXT); INSERT INTO t VALUES(1,3,'a'),(2,1,'a'),(3,6,'b'),(4,1,'b'); {query};\""),
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
