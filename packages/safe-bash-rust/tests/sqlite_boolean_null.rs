use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_boolean_null_predicates() {
    for (predicate, expected) in [
        ("(n OR 0) IS NULL", "1\n"),
        ("(0 OR n) IS NULL", "1\n"),
        ("(n OR 1) IS NULL", "0\n"),
        ("(1 OR n) IS NULL", "0\n"),
        ("(n AND 1) IS NULL", "1\n"),
        ("(1 AND n) IS NULL", "1\n"),
        ("(n AND 0) IS NULL", "0\n"),
        ("(0 AND n) IS NULL", "0\n"),
        ("(NOT n) IS NULL", "1\n"),
        ("((n OR 0) AND 1) IS NULL", "1\n"),
        ("(n OR 0)", "1\n"),
        ("(n AND 1)", "1\n"),
        ("(n OR 0 + 0) IS NULL", "1\n"),
        ("(n OR 0 AND 1) IS NULL", "1\n"),
        ("(n OR 1 AND 0) IS NULL", "1\n"),
        ("(CASE WHEN n OR 0 THEN 1 ELSE NULL END) IS NULL", "2\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec_with_options(
            &format!("sqlite3 :memory: 'CREATE TABLE t(n); INSERT INTO t VALUES(NULL),(0),(1);SELECT count(*) FROM t WHERE {predicate};'"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        ).unwrap();
        assert_eq!(result.exit_code, 0, "{predicate}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{predicate}");
    }
}

#[test]
fn sqlite_boolean_truth_tables() {
    for (lhs, rhs, or, and) in [
        ("NULL", "NULL", "NULL", "NULL"),
        ("NULL", "0", "NULL", "0"),
        ("NULL", "1", "1", "NULL"),
        ("0", "NULL", "NULL", "0"),
        ("0", "0", "0", "0"),
        ("0", "1", "1", "0"),
        ("1", "NULL", "1", "NULL"),
        ("1", "0", "1", "0"),
        ("1", "1", "1", "1"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec(&format!(
                "sqlite3 -nullvalue NULL :memory: 'SELECT {lhs} OR {rhs}, {lhs} AND {rhs};'"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, format!("{or}|{and}\n"), "{lhs}, {rhs}");
    }
}
