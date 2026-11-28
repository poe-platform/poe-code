use safe_bash_rust::{ExecOptions, Shell};

#[test]
fn sqlite_update_rejects_duplicate_integer_primary_key_through_shell() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "sqlite3 :memory: 'CREATE TABLE t(id INTEGER PRIMARY KEY);INSERT INTO t VALUES(1),(2); UPDATE t SET id=1 WHERE id=2; SELECT id FROM t ORDER BY id;'",
            ExecOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 19, "{result:?}");
    assert_eq!(result.stdout, "");
    assert_eq!(
        result.stderr,
        "Error: stepping, UNIQUE constraint failed: t.id (19)\n"
    );
}

#[test]
fn sqlite_primary_key_update_failure_rolls_back_rows_and_triggers() {
    for update in [
        "UPDATE t SET id=replacement RETURNING id",
        "WITH candidate(n) AS (VALUES (3)) UPDATE t SET id=replacement",
        "UPDATE t SET id=source.n FROM source",
        "CREATE TRIGGER conflict AFTER INSERT ON source BEGIN UPDATE t SET id=replacement; END; INSERT INTO source VALUES(4)",
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec("sqlite3 /db 'CREATE TABLE t(id INTEGER PRIMARY KEY, replacement); INSERT INTO t VALUES(1,3),(2,3); CREATE TABLE audit(id); CREATE TRIGGER changed AFTER UPDATE ON t BEGIN INSERT INTO audit VALUES(NEW.id); END; CREATE TABLE source(n); INSERT INTO source VALUES(3);'").unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell.exec(&format!("sqlite3 /db '{update}'")).unwrap();
        assert_eq!(result.exit_code, 19, "{update}: {result:?}");
        assert_eq!(result.stdout, "", "{update}");
        assert_eq!(
            result.stderr,
            "Error: stepping, UNIQUE constraint failed: t.id (19)\n"
        );
        let stored = shell.exec("sqlite3 /db 'SELECT id FROM t ORDER BY id; SELECT count(*) FROM audit; SELECT n FROM source;'").unwrap();
        assert_eq!(stored.exit_code, 0, "{stored:?}");
        assert_eq!(stored.stdout, "1\n2\n0\n3\n", "{update}");
    }
}

#[test]
fn sqlite_primary_key_updates_allow_unchanged_and_available_keys() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /db 'CREATE TABLE t(value, id INTEGER PRIMARY KEY); INSERT INTO t VALUES(7,1),(8,2); UPDATE t SET id=id; UPDATE t SET id=3 WHERE id=2 RETURNING id; UPDATE t SET id=1 WHERE id=99; UPDATE t SET value=9 WHERE id=1;'").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "3\n");
    let stored = shell
        .exec("sqlite3 /db 'SELECT id,value FROM t ORDER BY id;'")
        .unwrap();
    assert_eq!(stored.exit_code, 0, "{stored:?}");
    assert_eq!(stored.stdout, "1|9\n3|8\n");
}

#[test]
fn sqlite_primary_key_update_checks_conflicts_after_before_triggers() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /db 'CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES(1); CREATE TRIGGER reserve BEFORE UPDATE ON t BEGIN INSERT INTO t VALUES(2); END; UPDATE t SET id=2;'").unwrap();
    assert_eq!(result.exit_code, 19, "{result:?}");
    assert_eq!(result.stdout, "");
    assert_eq!(
        result.stderr,
        "Error: stepping, UNIQUE constraint failed: t.id (19)\n"
    );
    let stored = shell.exec("sqlite3 /db 'SELECT id FROM t;'").unwrap();
    assert_eq!(stored.stdout, "1\n");
}

#[test]
fn sqlite_update_checks_complete_unique_keys_and_allows_nulls() {
    let (mut shell, _) = Shell::with_memory_fs();
    let setup = shell.exec("sqlite3 /db 'CREATE TABLE t(a,b,PRIMARY KEY(a,b)); INSERT INTO t VALUES(1,1),(1,2),(2,1); UPDATE t SET b=3 WHERE b=2; UPDATE t SET b=NULL WHERE a=2;'").unwrap();
    assert_eq!(setup.exit_code, 0, "{setup:?}");
    let result = shell
        .exec("sqlite3 /db 'UPDATE t SET b=1 WHERE b=3;'")
        .unwrap();
    assert_eq!(result.exit_code, 19, "{result:?}");
    assert_eq!(
        result.stderr,
        "Error: stepping, UNIQUE constraint failed: t.a, t.b (19)\n"
    );
    let valid = shell
        .exec("sqlite3 /db 'UPDATE t SET b=NULL; SELECT count(*) FROM t;'")
        .unwrap();
    assert_eq!(valid.exit_code, 0, "{valid:?}");
    assert_eq!(valid.stdout, "3\n");
}
