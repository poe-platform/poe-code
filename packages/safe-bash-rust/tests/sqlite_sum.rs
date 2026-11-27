use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_sum_rejects_integer_overflow_and_preserves_data() {
    for (values, expected) in [
        ("(9223372036854775807),(1)", "9223372036854775807\n1\n"),
        ("(-9223372036854775808),(-1)", "-9223372036854775808\n-1\n"),
    ] {
        for database in [":memory:", "/sum.db"] {
            let (mut shell, _) = Shell::with_memory_fs();
            let result = shell.exec_with_options(
                &format!("sqlite3 {database} <<'INPUT'\nCREATE TABLE t(n); INSERT INTO t VALUES{values}; SELECT sum(n) FROM t;\nINPUT"),
                ExecOptions { cwd: Some("/".into()), env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]), ..Default::default() },
            ).unwrap();
            assert_eq!(result.exit_code, 1, "{values}: {result:?}");
            assert_eq!(result.stdout, "");
            assert!(
                result.stderr.contains("integer overflow"),
                "{}",
                result.stderr
            );
            if database != ":memory:" {
                let result = shell.exec("sqlite3 /sum.db 'SELECT n FROM t;'").unwrap();
                assert_eq!(result.exit_code, 0, "{}", result.stderr);
                assert_eq!(result.stdout, expected);
            }
        }
    }
}

#[test]
fn sqlite_sum_keeps_exact_integers_and_real_sums() {
    for (values, expected) in [
        ("(9223372036854775806),(1)", "9223372036854775807\n"),
        ("(-9223372036854775807),(-1)", "-9223372036854775808\n"),
        ("(9223372036854775807),(-9223372036854775807),(1)", "1\n"),
        ("(1.5),(2)", "3.5\n"),
        ("(9223372036854775805),(1)", "9223372036854775806\n"),
        ("(9223372036854775807),(1),(0.0)", "9223372036854775808.0\n"),
        ("(NULL),(NULL)", "\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!("sqlite3 :memory: 'CREATE TABLE t(n); INSERT INTO t VALUES{values}; SELECT sum(n) FROM t;'")).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{values}");
    }
}

#[test]
fn sqlite_sum_overflow_survives_group_expressions() {
    for query in [
        "SELECT sum(n) + 1 FROM t",
        "SELECT coalesce(sum(n), 0) FROM t",
        "SELECT sum(DISTINCT n) FROM t",
        "SELECT count(*) FROM t GROUP BY 1+0 HAVING sum(n)>0",
        "SELECT sum(n) FROM t GROUP BY 1+0",
        "WITH data AS (SELECT n FROM t) SELECT sum(n) FROM data",
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!("sqlite3 :memory: 'CREATE TABLE t(n); INSERT INTO t VALUES(9223372036854775807),(1); {query};'")).unwrap();
        assert_eq!(result.exit_code, 1, "{query}: {result:?}");
        assert_eq!(result.stdout, "", "{query}");
        assert!(
            result.stderr.contains("integer overflow"),
            "{query}: {}",
            result.stderr
        );
    }
}

#[test]
fn sqlite_sum_overflow_does_not_insert_an_error_value() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /sum.db 'CREATE TABLE t(n); INSERT INTO t VALUES(9223372036854775807),(1); CREATE TABLE totals(n); INSERT INTO totals VALUES(7); INSERT INTO totals SELECT sum(n) FROM t;'").unwrap();
    assert_eq!(result.exit_code, 1, "{result:?}");
    assert!(result.stderr.contains("integer overflow"));
    let result = shell
        .exec("sqlite3 /sum.db 'SELECT n FROM totals; SELECT n FROM t;'")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "7\n9223372036854775807\n1\n");
}

#[test]
fn csvsql_reports_sum_overflow() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec("printf 'n\n9223372036854775807\n1\n' | csvsql --query 'SELECT sum(n) FROM stdin'")
        .unwrap();
    assert_eq!(result.exit_code, 1, "{result:?}");
    assert_eq!(result.stdout, "");
    assert!(result.stderr.contains("integer overflow"));
}
