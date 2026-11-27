use safe_bash_rust::{ExecOptions, Shell};

#[test]
fn sqlite_update_of_only_fires_for_named_columns() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(a,b); CREATE TABLE log(n); CREATE TRIGGER tr AFTER UPDATE OF a ON t BEGIN INSERT INTO log VALUES(1); END; INSERT INTO t VALUES(1,2); UPDATE t SET b=9; UPDATE t SET a=8; SELECT count(*) FROM log;\nINPUT",
        ExecOptions { cwd: Some("/".into()), env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(), ..Default::default() },
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "1\n");
    assert_eq!(result.stderr, "");
}

#[test]
fn sqlite_update_of_survives_storage_and_matches_before_after_and_unchanged_values() {
    for timing in ["BEFORE", "AFTER"] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec(&format!("sqlite3 /db 'CREATE TABLE t(a,b,c); CREATE TABLE log(n); CREATE TRIGGER tr {timing} UPDATE OF \"A\", c, missing ON t BEGIN INSERT INTO log VALUES(1); END; CREATE TRIGGER every_update {timing} UPDATE ON t BEGIN INSERT INTO log VALUES(2); END; INSERT INTO t VALUES(1,2,3);'")).unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell.exec("sqlite3 /db 'UPDATE t SET b=9; UPDATE t SET a=a; UPDATE t SET b=8,c=3; SELECT n,count(*) FROM log GROUP BY n ORDER BY n;'").unwrap();
        assert_eq!(result.exit_code, 0, "{result:?}");
        assert_eq!(result.stdout, "1|2\n2|3\n", "{timing}");
    }
}

#[test]
fn sqlite_update_of_filters_upsert_and_nested_updates() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: 'CREATE TABLE t(id PRIMARY KEY,a,b); CREATE TABLE log(n); CREATE TRIGGER tr AFTER UPDATE OF a ON t BEGIN INSERT INTO log VALUES(1); END; INSERT INTO t VALUES(1,2,3); INSERT INTO t VALUES(1,4,5) ON CONFLICT(id) DO UPDATE SET b=excluded.b; INSERT INTO t VALUES(1,4,5) ON CONFLICT(id) DO UPDATE SET a=a; CREATE TABLE source(n); CREATE TRIGGER nested AFTER INSERT ON source BEGIN UPDATE t SET b=7; END; INSERT INTO source VALUES(1); SELECT count(*) FROM log;'").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "1\n");
}

#[test]
fn sqlite_update_of_filters_foreign_key_cascade_columns() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: 'PRAGMA foreign_keys=ON; CREATE TABLE p(id PRIMARY KEY); CREATE TABLE c(pid REFERENCES p(id) ON UPDATE CASCADE,b); CREATE TABLE log(n); CREATE TRIGGER relevant AFTER UPDATE OF pid ON c BEGIN INSERT INTO log VALUES(1); END; CREATE TRIGGER unrelated AFTER UPDATE OF b ON c BEGIN INSERT INTO log VALUES(2); END; INSERT INTO p VALUES(1); INSERT INTO c VALUES(1,3); UPDATE p SET id=2; SELECT n FROM log;'").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "1\n");
}
