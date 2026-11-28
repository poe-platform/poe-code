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
fn sqlite_recursive_triggers_off_preserves_rows_and_schema_after_reopening() {
    let mut shell = shell();
    let table = "CREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE,v INT CHECK(v>=0))";
    let trigger = "CREATE TRIGGER bump AFTER UPDATE OF v ON t WHEN NEW.v<15 BEGIN UPDATE t SET v=NEW.v+1 WHERE id=NEW.id;END";
    for sql in [
        format!("{table}; INSERT INTO t VALUES(1,1,10),(2,2,20),(3,3,30);{trigger};"),
        "PRAGMA recursive_triggers=OFF;UPDATE t SET v=11 WHERE id=1;".into(),
    ] {
        let result = shell.exec(&format!("sqlite3 ledger.db '{sql}'")).unwrap();
        assert_eq!(
            (
                result.exit_code,
                result.stdout.as_str(),
                result.stderr.as_str()
            ),
            (0, "", "")
        );
        assert!(!result.used_typescript_bridge);
    }
    let result = shell
        .exec("sqlite3 ledger.db 'SELECT id,k,v FROM t ORDER BY id;'")
        .unwrap();
    assert_eq!(
        (
            result.exit_code,
            result.stdout.as_str(),
            result.stderr.as_str()
        ),
        (0, "1|1|12\n2|2|20\n3|3|30\n", "")
    );
    let result = shell
        .exec("sqlite3 ledger.db \"SELECT sql FROM sqlite_master WHERE type='table';\"")
        .unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    assert_eq!(result.stdout, format!("{table}\n"));
}

#[test]
fn sqlite_recursive_triggers_can_toggle_and_reset_on_reopen() {
    let mut shell = shell();
    let result = shell.exec("sqlite3 ledger.db 'CREATE TABLE t(v); INSERT INTO t VALUES(10); CREATE TRIGGER bump AFTER UPDATE ON t WHEN NEW.v<15 BEGIN UPDATE t SET v=NEW.v+1; END; PRAGMA recursive_triggers; PRAGMA recursive_triggers=ON; PRAGMA recursive_triggers; UPDATE t SET v=11; SELECT v FROM t; PRAGMA recursive_triggers=OFF; PRAGMA recursive_triggers; UPDATE t SET v=11; SELECT v FROM t; PRAGMA recursive_triggers=ON;'").unwrap();
    assert_eq!(
        (
            result.exit_code,
            result.stdout.as_str(),
            result.stderr.as_str()
        ),
        (0, "0\n1\n15\n0\n12\n", "")
    );
    let result = shell
        .exec("sqlite3 ledger.db 'PRAGMA recursive_triggers; UPDATE t SET v=11; SELECT v FROM t;'")
        .unwrap();
    assert_eq!(
        (
            result.exit_code,
            result.stdout.as_str(),
            result.stderr.as_str()
        ),
        (0, "0\n12\n", "")
    );
}

#[test]
fn sqlite_recursive_triggers_off_allows_other_triggers_and_later_rows() {
    let result = shell().exec("sqlite3 :memory: 'PRAGMA recursive_triggers=OFF; CREATE TABLE t(id,v); CREATE TABLE log(id,v); INSERT INTO t VALUES(1,10),(2,10); CREATE TRIGGER bump AFTER UPDATE ON t WHEN NEW.v<15 BEGIN INSERT INTO log VALUES(NEW.id,NEW.v); END; CREATE TRIGGER logged AFTER INSERT ON log BEGIN UPDATE t SET v=NEW.v+1 WHERE id=NEW.id; END; UPDATE t SET v=11; SELECT id,v FROM t ORDER BY id; SELECT id,v FROM log ORDER BY id; UPDATE t SET v=12; SELECT id,v FROM t ORDER BY id;'").unwrap();
    assert_eq!(
        (
            result.exit_code,
            result.stdout.as_str(),
            result.stderr.as_str()
        ),
        (0, "1|12\n2|12\n1|11\n2|11\n1|13\n2|13\n", "")
    );
}

#[test]
fn sqlite_recursive_triggers_controls_insert_and_delete_reentry() {
    for (setting, inserted, remaining) in [("OFF", "1\n2\n", "3\n4\n"), ("ON", "1\n2\n3\n4\n", "")]
    {
        let result = shell().exec(&format!("sqlite3 :memory: 'PRAGMA recursive_triggers={setting}; CREATE TABLE inserted(v); CREATE TRIGGER add_next AFTER INSERT ON inserted WHEN NEW.v<4 BEGIN INSERT INTO inserted VALUES(NEW.v+1); END; INSERT INTO inserted VALUES(1); SELECT v FROM inserted ORDER BY v; SELECT 99; CREATE TABLE deleted(v); INSERT INTO deleted VALUES(1),(2),(3),(4); CREATE TRIGGER delete_next AFTER DELETE ON deleted BEGIN DELETE FROM deleted WHERE v=OLD.v+1; END; DELETE FROM deleted WHERE v=1; SELECT v FROM deleted ORDER BY v;'")).unwrap();
        assert_eq!(
            (
                result.exit_code,
                result.stdout.as_str(),
                result.stderr.as_str()
            ),
            (0, format!("{inserted}99\n{remaining}").as_str(), ""),
            "{setting}"
        );
    }
}

#[test]
fn sqlite_recursive_triggers_off_keeps_instead_of_views_writable() {
    for (setting, expected) in [("OFF", "1\n"), ("ON", "1\n2\n3\n")] {
        let result = shell().exec(&format!("sqlite3 :memory: 'PRAGMA recursive_triggers={setting}; CREATE TABLE t(v); CREATE VIEW v AS SELECT v FROM t; CREATE TRIGGER vi INSTEAD OF INSERT ON v WHEN NEW.v<4 BEGIN INSERT INTO t VALUES(NEW.v); INSERT INTO v VALUES(NEW.v+1); END; INSERT INTO v VALUES(1); SELECT v FROM t ORDER BY v;'")).unwrap();
        assert_eq!(
            (
                result.exit_code,
                result.stdout.as_str(),
                result.stderr.as_str()
            ),
            (0, expected, ""),
            "{setting}"
        );
    }
}
