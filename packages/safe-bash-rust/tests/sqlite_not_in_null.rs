use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite3_not_in_with_null_candidate_excludes_unmatched_rows() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(k); INSERT INTO t VALUES(1),(2); SELECT count(*) FROM t WHERE k NOT IN (1,NULL);\nINPUT",
        ExecOptions {
            cwd: Some("/".into()),
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "0\n");
}

#[test]
fn sqlite3_not_in_list_handles_null_candidates_and_text_literals() {
    for (predicate, expected) in [
        ("k NOT IN (NULL,1)", "0\n"),
        ("k NOT IN (NULL)", "0\n"),
        ("k NOT IN (1,NULLIF(2,2))", "0\n"),
        ("k NOT IN (1,n)", "0\n"),
        ("k NOT IN (1,(NULL))", "0\n"),
        ("NULL NOT IN (1,2)", "0\n"),
        ("NULL NOT IN ()", "2\n"),
        ("k NOT IN (1,NULL) OR k=2", "1\n"),
        ("k NOT IN (1,NULL) AND k=2", "0\n"),
        ("k IN (1,NULL)", "1\n"),
        ("k NOT IN (1)", "1\n"),
        ("k NOT IN (1,2)", "0\n"),
        ("k NOT IN ()", "2\n"),
        ("k NOT IN (1,'')", "1\n"),
        ("k NOT IN (1,'NULL')", "1\n"),
        ("k NOT IN (1,substr('x',2))", "1\n"),
        ("k NOT IN (SELECT v FROM candidates)", "0\n"),
        ("k NOT IN (SELECT NULL)", "0\n"),
        ("k NOT IN (SELECT v FROM candidates WHERE v=1)", "1\n"),
        ("k NOT IN (SELECT v FROM candidates WHERE v=3)", "2\n"),
        ("NULL NOT IN (SELECT v FROM candidates WHERE v=1)", "0\n"),
        ("NULL NOT IN (SELECT v FROM candidates WHERE v=3)", "2\n"),
        ("k NOT IN (SELECT '')", "2\n"),
        ("k NOT IN (SELECT 'NULL')", "2\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(k,n); INSERT INTO t VALUES(1,NULL),(2,NULL); CREATE TABLE candidates(v); INSERT INTO candidates VALUES(1),(NULL); SELECT count(*) FROM t WHERE {predicate};\nINPUT"
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{predicate}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{predicate}");
    }
}

#[test]
fn sqlite3_not_in_with_null_candidate_does_not_mutate_unmatched_rows() {
    for mutation in [
        "UPDATE t SET k=3 WHERE k NOT IN (1,NULL)",
        "DELETE FROM t WHERE k NOT IN (1,NULL)",
        "UPDATE t SET k=3 WHERE k NOT IN (SELECT NULL)",
        "DELETE FROM t WHERE k NOT IN (SELECT NULL)",
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(k); INSERT INTO t VALUES(1),(2); {mutation}; SELECT k FROM t ORDER BY k;\nINPUT"
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{mutation}: {}", result.stderr);
        assert_eq!(result.stdout, "1\n2\n", "{mutation}");
    }
}
