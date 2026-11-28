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
fn sqlite_drop_table_applies_foreign_keys_and_persists_schema() {
    for (pragma, action, expected) in [
        ("ON", "CASCADE", "0\n0\nc\n"),
        ("OFF", "CASCADE", "1\n0\nc\n"),
        ("ON", "SET NULL", "1\n1\nc\n"),
        ("ON", "SET DEFAULT", "1\n1\nc\n"),
    ] {
        let mut shell = shell();
        for (sql, stdout) in [
            (
                format!("CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(x INTEGER REFERENCES p(id) ON DELETE {action}); INSERT INTO p VALUES(1); INSERT INTO c VALUES(1);"),
                "",
            ),
            (format!("PRAGMA foreign_keys={pragma}; DROP TABLE p;"), ""),
            (
                "SELECT count(*) FROM c; SELECT count(*) FROM c WHERE x IS NULL; SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;".into(),
                expected,
            ),
        ] {
            let result = shell.exec(&format!("sqlite3 ledger.db <<'SQL'\n{sql}\nSQL")).unwrap();
            assert_eq!(result.exit_code, 0, "{pragma}, {action}, {sql}: {result:?}");
            assert_eq!(result.stderr, "");
            assert_eq!(result.stdout, stdout, "{pragma}, {action}, {sql}");
            assert!(!result.used_typescript_bridge);
        }
    }
}

#[test]
fn sqlite_drop_table_restriction_restores_rows_and_schema() {
    for action in ["NO ACTION", "RESTRICT"] {
        let mut shell = shell();
        let setup = shell.exec(&format!("sqlite3 ledger.db 'CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE a(x REFERENCES p(id) ON DELETE CASCADE); CREATE TABLE c(x REFERENCES p(id) ON DELETE {action}); INSERT INTO p VALUES(1),(2); INSERT INTO a VALUES(1),(2); INSERT INTO c VALUES(2);'")).unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell.exec("sqlite3 ledger.db 'PRAGMA foreign_keys=ON; INSERT INTO p VALUES(3); DROP TABLE p;'").unwrap();
        assert_eq!(result.exit_code, 1, "{action}: {result:?}");
        assert_eq!(result.stderr, "Error: FOREIGN KEY constraint failed\n");
        let reopened = shell.exec("sqlite3 ledger.db 'SELECT id FROM p ORDER BY id; SELECT x FROM a ORDER BY x; SELECT x FROM c;'").unwrap();
        assert_eq!(reopened.exit_code, 0, "{reopened:?}");
        assert_eq!(reopened.stdout, "1\n2\n3\n1\n2\n2\n");
    }
}

#[test]
fn sqlite_drop_table_removes_indexes_and_triggers_without_firing_them() {
    let mut shell = shell();
    let setup = shell.exec("sqlite3 ledger.db 'CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE INDEX p_idx ON p(id); CREATE TABLE log(id); CREATE TRIGGER deleted AFTER DELETE ON p BEGIN INSERT INTO log VALUES(OLD.id); END; INSERT INTO p VALUES(1);'").unwrap();
    assert_eq!(setup.exit_code, 0, "{setup:?}");
    let result = shell
        .exec("sqlite3 ledger.db 'PRAGMA foreign_keys=ON; DROP TABLE IF EXISTS P;'")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    let reopened = shell.exec("sqlite3 ledger.db 'SELECT name FROM sqlite_master ORDER BY name; CREATE TABLE p(id INTEGER PRIMARY KEY); INSERT INTO p VALUES(2); DELETE FROM p; SELECT count(*) FROM log;'").unwrap();
    assert_eq!(reopened.exit_code, 0, "{reopened:?}");
    assert_eq!(reopened.stdout, "log\n0\n");
}

#[test]
fn sqlite_drop_table_can_be_rolled_back() {
    for ending in ["ROLLBACK;", "", "ROLLBACK TO s; RELEASE s;"] {
        let mut shell = shell();
        let setup = shell.exec("sqlite3 ledger.db 'CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(x REFERENCES p(id) ON DELETE CASCADE); INSERT INTO p VALUES(1); INSERT INTO c VALUES(1);'").unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell
            .exec(&format!(
                "sqlite3 ledger.db 'PRAGMA foreign_keys=ON; SAVEPOINT s; DROP TABLE p; {ending}'"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{ending}: {result:?}");
        let reopened = shell
            .exec("sqlite3 ledger.db 'SELECT id FROM p; SELECT x FROM c;'")
            .unwrap();
        assert_eq!(reopened.exit_code, 0, "{ending}: {reopened:?}");
        assert_eq!(reopened.stdout, "1\n1\n");
    }
}

#[test]
fn sqlite_drop_table_missing_requires_if_exists() {
    let mut shell = shell();
    let absent = shell
        .exec("sqlite3 ledger.db 'DROP TABLE missing;'")
        .unwrap();
    assert_eq!(absent.exit_code, 1, "{absent:?}");
    assert_eq!(absent.stderr, "Error: no such table: missing\n");
    let allowed = shell
        .exec("sqlite3 ledger.db 'DROP TABLE IF EXISTS missing;'")
        .unwrap();
    assert_eq!(allowed.exit_code, 0, "{allowed:?}");
    assert_eq!(allowed.stderr, "");
}

#[test]
fn sqlite_drop_table_rollback_restores_indexes_and_triggers() {
    for transaction in [
        "BEGIN; DROP TABLE p; ROLLBACK;",
        "SAVEPOINT s; DROP TABLE p; ROLLBACK TO s; RELEASE s;",
        "BEGIN; DROP TABLE p;",
    ] {
        let mut shell = shell();
        let setup = shell.exec("sqlite3 ledger.db 'CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE INDEX p_idx ON p(id); CREATE TABLE log(id); CREATE TRIGGER deleted AFTER DELETE ON p BEGIN INSERT INTO log VALUES(OLD.id); END; INSERT INTO p VALUES(1);'").unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell
            .exec(&format!(
                "sqlite3 ledger.db 'PRAGMA foreign_keys=ON; {transaction}'"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{transaction}: {result:?}");
        let reopened = shell.exec("sqlite3 ledger.db <<'SQL'\nSELECT name FROM sqlite_master WHERE type='index'; DELETE FROM p; SELECT id FROM log;\nSQL").unwrap();
        assert_eq!(reopened.exit_code, 0, "{transaction}: {reopened:?}");
        assert_eq!(reopened.stdout, "p_idx\n1\n", "{transaction}");
    }
}

#[test]
fn sqlite_drop_table_respects_deferred_constraints() {
    for (action, ending, fails, expected) in [
        ("NO ACTION", "DELETE FROM c; COMMIT;", false, "c\n0\n"),
        ("NO ACTION", "COMMIT;", true, "c\np\n1\n"),
        ("RESTRICT", "DELETE FROM c; COMMIT;", true, "c\np\n1\n"),
    ] {
        let mut shell = shell();
        let setup = shell.exec(&format!("sqlite3 ledger.db 'CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(x REFERENCES p(id) ON DELETE {action} DEFERRABLE INITIALLY DEFERRED); INSERT INTO p VALUES(1); INSERT INTO c VALUES(1);'")).unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell
            .exec(&format!(
                "sqlite3 ledger.db 'PRAGMA foreign_keys=ON; BEGIN; DROP TABLE p; {ending}'"
            ))
            .unwrap();
        assert_eq!(
            result.exit_code,
            i32::from(fails),
            "{action}, {ending}: {result:?}"
        );
        let reopened = shell.exec("sqlite3 ledger.db <<'SQL'\nSELECT name FROM sqlite_master WHERE type='table' ORDER BY name; SELECT count(*) FROM c;\nSQL").unwrap();
        assert_eq!(reopened.exit_code, 0, "{reopened:?}");
        assert_eq!(reopened.stdout, expected, "{action}, {ending}");
    }
}
