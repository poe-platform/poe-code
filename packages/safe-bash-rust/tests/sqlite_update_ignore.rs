use safe_bash_rust::Shell;

#[test]
fn sqlite_update_ignore_persists_valid_updates_after_uniqueness_conflicts() {
    let (mut shell, _) = Shell::with_memory_fs();
    let setup = shell.exec("sqlite3 /ledger.db 'CREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE,v INT CHECK(v>=0)); INSERT INTO t VALUES(1,1,10),(2,2,20),(3,3,30);'").unwrap();
    assert_eq!(setup.exit_code, 0, "{setup:?}");
    let update = shell
        .exec("sqlite3 /ledger.db 'UPDATE OR IGNORE t SET k=id+1;'")
        .unwrap();
    assert_eq!(update.exit_code, 0, "{update:?}");
    assert_eq!(update.stdout, "");
    assert_eq!(update.stderr, "");
    let reopened = shell
        .exec("sqlite3 /ledger.db 'SELECT id,k,v FROM t ORDER BY id;'")
        .unwrap();
    assert_eq!(reopened.exit_code, 0, "{reopened:?}");
    assert_eq!(reopened.stdout, "1|1|10\n2|2|20\n3|4|30\n");
}

#[test]
fn sqlite_update_ignore_skips_only_conflicting_rows() {
    for (assignment, rows, returned) in [
        ("k=id+1", "1|1|10\n2|2|20\n3|4|30\n", "3|4|30\n"),
        ("id=id+1", "1|1|10\n2|2|20\n4|3|30\n", "4|3|30\n"),
        ("v=v-20", "1|1|10\n2|2|0\n3|3|10\n", "2|2|0\n3|3|10\n"),
        (
            "v=NULLIF(v,20)",
            "1|1|10\n2|2|20\n3|3|30\n",
            "1|1|10\n3|3|30\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec("sqlite3 /ledger.db 'CREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE,v INT NOT NULL CHECK(v>=0)); INSERT INTO t VALUES(1,1,10),(2,2,20),(3,3,30);'").unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let schema = shell
            .exec("sqlite3 /ledger.db 'SELECT sql FROM sqlite_master ORDER BY name;'")
            .unwrap();
        assert_eq!(schema.exit_code, 0, "{schema:?}");
        assert!(!schema.stdout.is_empty());
        let update = shell
            .exec(&format!(
                "sqlite3 /ledger.db 'UPDATE OR IGNORE t SET {assignment} RETURNING id,k,v;'"
            ))
            .unwrap();
        assert_eq!(update.exit_code, 0, "{assignment}: {update:?}");
        assert_eq!(update.stderr, "");
        assert_eq!(update.stdout, returned, "{assignment}");
        let reopened = shell
            .exec("sqlite3 /ledger.db 'SELECT id,k,v FROM t ORDER BY id;'")
            .unwrap();
        assert_eq!(reopened.exit_code, 0, "{reopened:?}");
        assert_eq!(reopened.stdout, rows, "{assignment}");
        assert_eq!(
            shell
                .exec("sqlite3 /ledger.db 'SELECT sql FROM sqlite_master ORDER BY name;'")
                .unwrap()
                .stdout,
            schema.stdout
        );
    }
}
