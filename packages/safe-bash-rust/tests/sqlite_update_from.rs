use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::{collections::BTreeMap, sync::Arc};

fn run_sql(sql: &str) -> String {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
        },
    );
    let result = shell
        .exec_with_options(
            &format!("sqlite3 :memory: <<'INPUT'\n{sql}\nINPUT"),
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    result.stdout
}

#[test]
fn sqlite_update_from_uses_matching_join_values() {
    assert_eq!(
        run_sql(
            "CREATE TABLE t(id,n); CREATE TABLE u(id,n); INSERT INTO t VALUES(1,4),(2,5); INSERT INTO u VALUES(2,8); UPDATE t SET n=u.n FROM u WHERE t.id=u.id; SELECT n FROM t ORDER BY id;"
        ),
        "4\n8\n"
    );
}

#[test]
fn sqlite_update_from_empty_or_unmatched_source_leaves_rows_unchanged() {
    for source in ["", "INSERT INTO u VALUES(3,8);"] {
        assert_eq!(
            run_sql(&format!(
                "CREATE TABLE t(id,n); CREATE TABLE u(id,n); INSERT INTO t VALUES(1,4),(2,5); {source} UPDATE t SET n=u.n FROM u WHERE t.id=u.id; SELECT n FROM t ORDER BY id;"
            )),
            "4\n5\n"
        );
    }
}

#[test]
fn sqlite_update_from_alias_evaluates_assignments_against_original_row() {
    assert_eq!(
        run_sql(
            "CREATE TABLE t(id,n); CREATE TABLE u(id,n); INSERT INTO t VALUES(1,4),(2,5); INSERT INTO u VALUES(2,8); UPDATE t SET n=source.n+t.n, id=t.n FROM u AS source WHERE t.id=source.id RETURNING id,n; SELECT id,n FROM t ORDER BY id;"
        ),
        "5|13\n1|4\n5|13\n"
    );
}

#[test]
fn sqlite_update_from_updates_each_target_once() {
    assert_eq!(
        run_sql(
            "CREATE TABLE t(id,n); CREATE TABLE u(id,n); CREATE TABLE audit(n); INSERT INTO t VALUES(1,4); INSERT INTO u VALUES(1,8),(1,8); CREATE TRIGGER log_update AFTER UPDATE ON t BEGIN INSERT INTO audit VALUES(NEW.n); END; UPDATE t SET n=u.n FROM u WHERE t.id=u.id RETURNING n; SELECT n FROM audit;"
        ),
        "8\n8\n"
    );
}

#[test]
fn sqlite_update_from_without_where_uses_source_rows() {
    assert_eq!(
        run_sql(
            "CREATE TABLE t(n); CREATE TABLE u(n); INSERT INTO t VALUES(4),(5); INSERT INTO u VALUES(8); UPDATE t SET n=u.n FROM u; SELECT n FROM t; DELETE FROM u; UPDATE t SET n=9 FROM u; SELECT n FROM t;"
        ),
        "8\n8\n8\n8\n"
    );
}

#[test]
fn sqlite_update_preserves_from_inside_expressions() {
    assert_eq!(
        run_sql(
            "CREATE TABLE t(n); CREATE TABLE u(n); INSERT INTO t VALUES(4); INSERT INTO u VALUES(8); UPDATE t SET n='value FROM u'; SELECT n FROM t; UPDATE t SET n=(SELECT 8 FROM u); SELECT n FROM t;"
        ),
        "value FROM u\n8\n"
    );
}

#[test]
fn sqlite_update_from_join_preserves_qualified_source_columns() {
    assert_eq!(
        run_sql(
            "CREATE TABLE t(id,n); CREATE TABLE u(id,n); CREATE TABLE v(id,extra); INSERT INTO t VALUES(1,4),(2,5); INSERT INTO u VALUES(2,8); INSERT INTO v VALUES(2,3); UPDATE t SET n=u.n+v.extra FROM u JOIN v ON u.id=v.id WHERE t.id=u.id; SELECT n FROM t ORDER BY id;"
        ),
        "4\n11\n"
    );
}

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
