use safe_bash_rust::{ExecOptions, Shell};

#[test]
fn sqlite_dropped_trigger_stops_writing_after_reopening() {
    let (mut shell, _) = Shell::with_memory_fs();
    let setup = shell.exec_with_options(
        "sqlite3 ledger.db 'CREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE,v INT CHECK(v>=0)); INSERT INTO t VALUES(1,1,10),(2,2,20),(3,3,30);CREATE TABLE log(x);CREATE TRIGGER au AFTER UPDATE ON t BEGIN INSERT INTO log VALUES(NEW.v);END;'",
        ExecOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(setup.exit_code, 0, "{setup:?}");
    let dropped = shell
        .exec("sqlite3 /ledger.db 'DROP TRIGGER au;UPDATE t SET v=40;'")
        .unwrap();
    assert_eq!(dropped.exit_code, 0, "{dropped:?}");
    assert_eq!(dropped.stderr, "");
    let stored = shell.exec("sqlite3 /ledger.db 'SELECT count(*) FROM log; SELECT id,v FROM t ORDER BY id; UPDATE t SET v=50; SELECT count(*) FROM log;'").unwrap();
    assert_eq!(stored.exit_code, 0, "{stored:?}");
    assert_eq!(stored.stdout, "0\n1|40\n2|40\n3|40\n0\n");
}

#[test]
fn sqlite_drop_trigger_removes_only_the_named_trigger() {
    for name in ["au", "\"audit update\"", "\"audit\"\"update\""] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec(&format!("sqlite3 /db 'CREATE TABLE t(v); INSERT INTO t VALUES(1); CREATE TABLE audit(v); CREATE TRIGGER {name} AFTER UPDATE ON t BEGIN INSERT INTO audit VALUES(NEW.v); END; CREATE TRIGGER keep AFTER UPDATE ON t BEGIN INSERT INTO audit VALUES(99); END;'")).unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let dropped = shell
            .exec(&format!(
                "sqlite3 /db 'DROP TRIGGER {}; UPDATE t SET v=2;'",
                name.to_ascii_uppercase()
            ))
            .unwrap();
        assert_eq!(dropped.exit_code, 0, "{dropped:?}");
        let stored = shell.exec("sqlite3 /db 'UPDATE t SET v=3; SELECT v FROM audit; DROP TRIGGER keep; UPDATE t SET v=4; SELECT count(*) FROM audit;'").unwrap();
        assert_eq!(stored.exit_code, 0, "{stored:?}");
        assert_eq!(stored.stdout, "99\n99\n2\n", "{name}");
    }
}

#[test]
fn sqlite_drop_trigger_missing_and_if_exists() {
    let (mut shell, _) = Shell::with_memory_fs();
    let missing = shell
        .exec("sqlite3 :memory: 'DROP TRIGGER missing; SELECT 1;'")
        .unwrap();
    assert_eq!(missing.exit_code, 1, "{missing:?}");
    assert_eq!(missing.stderr, "Error: no such trigger: missing\n");
    assert_eq!(missing.stdout, "");
    let optional = shell
        .exec("sqlite3 :memory: 'DROP TRIGGER IF EXISTS missing; SELECT 1;'")
        .unwrap();
    assert_eq!(optional.exit_code, 0, "{optional:?}");
    assert_eq!(optional.stdout, "1\n");
    let existing = shell.exec("sqlite3 /db 'CREATE TABLE t(v);CREATE TABLE audit(v);CREATE TRIGGER au AFTER INSERT ON t BEGIN INSERT INTO audit VALUES(NEW.v);END;DROP TRIGGER IF EXISTS au;INSERT INTO t VALUES(1);SELECT count(*) FROM audit;'").unwrap();
    assert_eq!(existing.exit_code, 0, "{existing:?}");
    assert_eq!(existing.stdout, "0\n");
}

#[test]
fn sqlite_drop_trigger_rollbacks_restore_dispatch() {
    for transaction in [
        "BEGIN; DROP TRIGGER au; ROLLBACK;",
        "SAVEPOINT s; DROP TRIGGER au; ROLLBACK TO s; RELEASE s;",
        "BEGIN; DROP TRIGGER au;",
        "SAVEPOINT s; DROP TRIGGER au;",
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec("sqlite3 /db 'CREATE TABLE t(v);CREATE TABLE audit(v);CREATE TRIGGER au AFTER INSERT ON t BEGIN INSERT INTO audit VALUES(NEW.v);END;'").unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let dropped = shell.exec(&format!("sqlite3 /db '{transaction}'")).unwrap();
        assert_eq!(dropped.exit_code, 0, "{dropped:?}");
        let stored = shell
            .exec("sqlite3 /db 'INSERT INTO t VALUES(7);SELECT v FROM audit;'")
            .unwrap();
        assert_eq!(stored.exit_code, 0, "{stored:?}");
        assert_eq!(stored.stdout, "7\n", "{transaction}");
    }
}
