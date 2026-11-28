use safe_bash_rust::{BackendMode, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

fn shell() -> Shell {
    Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            mode: BackendMode::NativeOnly,
        },
    )
}

#[test]
fn sqlite_delete_cascade_reaches_grandchildren_after_reopening() {
    let mut shell = shell();
    let setup = shell.exec("sqlite3 ledger.db 'CREATE TABLE a(id INTEGER PRIMARY KEY);CREATE TABLE b(id INTEGER PRIMARY KEY REFERENCES a ON DELETE CASCADE);CREATE TABLE c(id INTEGER REFERENCES b ON DELETE CASCADE);INSERT INTO a VALUES(1);INSERT INTO b VALUES(1);INSERT INTO c VALUES(1);'").unwrap();
    assert_eq!(setup.exit_code, 0, "{setup:?}");
    let schema = shell
        .exec("sqlite3 ledger.db 'SELECT sql FROM sqlite_master ORDER BY name;'")
        .unwrap();
    assert_eq!(schema.exit_code, 0, "{schema:?}");
    assert!(schema.stdout.contains("REFERENCES a ON DELETE CASCADE"));
    assert!(schema.stdout.contains("REFERENCES b ON DELETE CASCADE"));
    let deleted = shell
        .exec("sqlite3 ledger.db 'PRAGMA foreign_keys=ON;DELETE FROM a;'")
        .unwrap();
    assert_eq!(deleted.exit_code, 0, "{deleted:?}");
    assert_eq!(deleted.stdout, "");
    assert_eq!(deleted.stderr, "");
    assert!(!deleted.used_typescript_bridge);
    let stored = shell.exec("sqlite3 ledger.db 'SELECT (SELECT count(*) FROM a),(SELECT count(*) FROM b),(SELECT count(*) FROM c);PRAGMA foreign_key_check;'").unwrap();
    assert_eq!(stored.exit_code, 0, "{stored:?}");
    assert_eq!(stored.stderr, "");
    assert_eq!(stored.stdout, "0|0|0\n");
    let reopened_schema = shell
        .exec("sqlite3 ledger.db 'SELECT sql FROM sqlite_master ORDER BY name;'")
        .unwrap();
    assert_eq!(reopened_schema.exit_code, 0, "{reopened_schema:?}");
    assert_eq!(reopened_schema.stdout, schema.stdout);
}

#[test]
fn sqlite_delete_cascade_preserves_other_branches_and_rowids() {
    let mut shell = shell();
    let setup = shell.exec("sqlite3 /db 'CREATE TABLE a(id INTEGER PRIMARY KEY);CREATE TABLE b(id INTEGER PRIMARY KEY,pid REFERENCES a(id) ON DELETE CASCADE);CREATE TABLE c(id INTEGER PRIMARY KEY,pid REFERENCES b(id) ON DELETE CASCADE);CREATE TABLE d(pid REFERENCES c(id) ON DELETE CASCADE);INSERT INTO a VALUES(1),(2);INSERT INTO b VALUES(10,1),(20,2),(30,1);INSERT INTO c VALUES(100,10),(200,20),(300,30),(400,NULL);INSERT INTO d VALUES(100),(200),(300);'").unwrap();
    assert_eq!(setup.exit_code, 0, "{setup:?}");
    let deleted = shell
        .exec("sqlite3 /db 'PRAGMA foreign_keys=ON;DELETE FROM a WHERE id=1 RETURNING id;'")
        .unwrap();
    assert_eq!(deleted.exit_code, 0, "{deleted:?}");
    assert_eq!(deleted.stdout, "1\n");
    let stored = shell.exec("sqlite3 /db 'SELECT id FROM a;SELECT id,pid FROM b;SELECT rowid,pid FROM c ORDER BY rowid;SELECT rowid,pid FROM d;'").unwrap();
    assert_eq!(stored.exit_code, 0, "{stored:?}");
    assert_eq!(stored.stdout, "2\n20|2\n200|20\n400|\n2|200\n");
}

#[test]
fn sqlite_delete_cascade_applies_descendant_actions_and_rolls_back_restrictions() {
    for (action, expected) in [
        ("CASCADE", "1|0|0|0\n"),
        ("SET NULL", "1|0|1|0\n"),
        ("SET DEFAULT", "1|0|1|1\n"),
        ("RESTRICT", "2|1|1|1\n"),
        ("NO ACTION", "2|1|1|1\n"),
    ] {
        let mut shell = shell();
        let setup = shell.exec(&format!("sqlite3 /db 'CREATE TABLE a(id INTEGER PRIMARY KEY);CREATE TABLE b(id INTEGER PRIMARY KEY REFERENCES a(id) ON DELETE CASCADE);CREATE TABLE c(pid INTEGER DEFAULT 0 REFERENCES b(id) ON DELETE {action});INSERT INTO a VALUES(0),(1);INSERT INTO b VALUES(0),(1);INSERT INTO c VALUES(1);'")).unwrap();
        assert_eq!(setup.exit_code, 0, "{action}: {setup:?}");
        let deleted = shell
            .exec("sqlite3 /db 'PRAGMA foreign_keys=ON;DELETE FROM a WHERE id=1 RETURNING id;'")
            .unwrap();
        if matches!(action, "RESTRICT" | "NO ACTION") {
            assert_ne!(deleted.exit_code, 0, "{action}: {deleted:?}");
            assert!(deleted.stderr.contains("FOREIGN KEY constraint failed"));
            assert_eq!(deleted.stdout, "");
        } else {
            assert_eq!(deleted.exit_code, 0, "{action}: {deleted:?}");
            assert_eq!(deleted.stdout, "1\n");
        }
        let stored = shell.exec("sqlite3 /db 'SELECT (SELECT count(*) FROM a),(SELECT count(*) FROM b WHERE id=1),(SELECT count(*) FROM c),(SELECT count(pid) FROM c);PRAGMA foreign_key_check;'").unwrap();
        assert_eq!(stored.exit_code, 0, "{action}: {stored:?}");
        assert_eq!(stored.stdout, expected, "{action}");
    }
}

#[test]
fn sqlite_delete_cascade_terminates_for_self_references_and_cycles() {
    for setup in [
        "CREATE TABLE a(id INTEGER PRIMARY KEY,pid REFERENCES a(id) ON DELETE CASCADE);INSERT INTO a VALUES(1,1),(2,1),(3,2),(4,4);",
        "CREATE TABLE a(id INTEGER PRIMARY KEY,pid REFERENCES b(id) ON DELETE CASCADE);CREATE TABLE b(id INTEGER PRIMARY KEY,pid REFERENCES a(id) ON DELETE CASCADE);INSERT INTO a VALUES(1,1),(4,4);INSERT INTO b VALUES(1,1),(4,4);",
    ] {
        let mut shell = shell();
        let created = shell.exec(&format!("sqlite3 /db '{setup}'")).unwrap();
        assert_eq!(created.exit_code, 0, "{created:?}");
        let deleted = shell
            .exec("sqlite3 /db 'PRAGMA foreign_keys=ON;DELETE FROM a WHERE id=1;'")
            .unwrap();
        assert_eq!(deleted.exit_code, 0, "{deleted:?}");
        let stored = shell
            .exec("sqlite3 /db 'SELECT id,pid FROM a;PRAGMA foreign_key_check;'")
            .unwrap();
        assert_eq!(stored.exit_code, 0, "{stored:?}");
        assert_eq!(stored.stdout, "4|4\n");
    }
}
