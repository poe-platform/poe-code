use safe_bash_rust::{ExecOptions, Shell};

#[test]
fn update_from_uses_matching_source_values() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(id,n); CREATE TABLE u(id,n); INSERT INTO t VALUES(1,4),(2,5); INSERT INTO u VALUES(2,8); UPDATE t SET n=u.n FROM u WHERE t.id=u.id; SELECT n FROM t ORDER BY id;\nINPUT",
        ExecOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "4\n8\n");
    assert_eq!(result.stderr, "");
}

#[test]
fn update_from_handles_aliases_expressions_and_returning() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: 'CREATE TABLE t(id,n); CREATE TABLE u(id,n); INSERT INTO t VALUES(1,4),(2,5); INSERT INTO u VALUES(2,8); UPDATE t SET n=t.n+source.n FROM u AS source WHERE t.id=source.id RETURNING id,n; SELECT n FROM t ORDER BY id;'").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "2|13\n4\n13\n");
    assert_eq!(result.stderr, "");
}

#[test]
fn update_from_empty_source_leaves_target_unchanged() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: 'CREATE TABLE t(n); CREATE TABLE u(n); INSERT INTO t VALUES(4); UPDATE t SET n=u.n FROM u; SELECT n FROM t;'").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "4\n");
}

#[test]
fn update_from_multiple_matches_updates_each_target_once() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: 'CREATE TABLE t(n); CREATE TABLE u(n); CREATE TABLE log(n); CREATE TRIGGER changed AFTER UPDATE ON t BEGIN INSERT INTO log VALUES(1); END; INSERT INTO t VALUES(4); INSERT INTO u VALUES(8),(8); UPDATE t SET n=t.n+u.n FROM u RETURNING n; SELECT count(*) FROM log;'").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "12\n1\n");
}

#[test]
fn update_assignment_preserves_quoted_and_subquery_from() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(n,label); CREATE TABLE u(value); INSERT INTO t VALUES(4,'old'); INSERT INTO u VALUES(8); UPDATE t SET n=(SELECT value FROM u),label='text FROM u'; SELECT * FROM t;\nINPUT").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "8|text FROM u\n");
}
