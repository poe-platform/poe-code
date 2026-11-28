use safe_bash_rust::Shell;

#[test]
fn update_replace_removes_conflicts_and_updates_surviving_rows_after_reopening() {
    for (update, expected) in [
        ("UPDATE OR REPLACE t SET k=id+1", "1|2|10\n3|4|30\n"),
        ("UPDATE OR REPLACE t SET k=1 WHERE id=3", "2|2|20\n3|1|30\n"),
        ("UPDATE OR REPLACE t SET id=2,k=3 WHERE id=1", "2|3|10\n"),
        ("UPDATE OR REPLACE t SET k=k", "1|1|10\n2|2|20\n3|3|30\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec("sqlite3 /ledger.db 'CREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE,v INT CHECK(v>=0)); INSERT INTO t VALUES(1,1,10),(2,2,20),(3,3,30);'").unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let schema = shell
            .exec("sqlite3 /ledger.db \"SELECT sql FROM sqlite_master WHERE name='t';\"")
            .unwrap();
        let changed = shell
            .exec(&format!("sqlite3 /ledger.db '{update};'"))
            .unwrap();
        assert_eq!(changed.exit_code, 0, "{update}: {changed:?}");
        assert_eq!(changed.stderr, "");
        let stored = shell
            .exec("sqlite3 /ledger.db 'SELECT id,k,v FROM t ORDER BY id;'")
            .unwrap();
        assert_eq!(stored.exit_code, 0, "{stored:?}");
        assert_eq!(stored.stdout, expected, "{update}");
        let reopened_schema = shell
            .exec("sqlite3 /ledger.db \"SELECT sql FROM sqlite_master WHERE name='t';\"")
            .unwrap();
        assert_eq!(reopened_schema.stdout, schema.stdout);
        assert!(schema.stdout.contains("CHECK"), "{schema:?}");
    }
}

#[test]
fn update_replace_rolls_back_prior_replacements_on_check_failure() {
    let (mut shell, _) = Shell::with_memory_fs();
    let setup = shell.exec("sqlite3 /ledger.db 'CREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE,v INT CHECK(v>=0)); INSERT INTO t VALUES(1,1,10),(2,2,20),(3,3,30);'").unwrap();
    assert_eq!(setup.exit_code, 0, "{setup:?}");
    let changed = shell
        .exec("sqlite3 /ledger.db 'UPDATE OR REPLACE t SET k=id+1,v=2-id;'")
        .unwrap();
    assert_eq!(changed.exit_code, 1, "{changed:?}");
    assert!(
        changed.stderr.contains("CHECK constraint failed"),
        "{changed:?}"
    );
    let stored = shell
        .exec("sqlite3 /ledger.db 'SELECT id,k,v FROM t ORDER BY id;'")
        .unwrap();
    assert_eq!(stored.stdout, "1|1|10\n2|2|20\n3|3|30\n");
}

#[test]
fn update_replace_overrides_declared_ignore_and_returns_only_survivors() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: 'CREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE ON CONFLICT IGNORE); CREATE TABLE audit(id INT); CREATE TRIGGER updated AFTER UPDATE ON t BEGIN INSERT INTO audit VALUES(new.id); END; INSERT INTO t VALUES(1,1),(2,2),(3,3); UPDATE OR REPLACE t SET k=id+1 RETURNING id,k; SELECT id FROM audit ORDER BY id;'").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "1|2\n3|4\n1\n3\n");
}
