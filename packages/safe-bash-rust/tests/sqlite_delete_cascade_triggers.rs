use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
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
fn sqlite_cascade_audit_trigger_survives_reopening() {
    let mut shell = shell();
    for (sql, expected) in [
        (
            "CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(x INT REFERENCES p ON DELETE CASCADE); CREATE TABLE log(n); CREATE TRIGGER ac AFTER DELETE ON c BEGIN INSERT INTO log VALUES(OLD.x); END; INSERT INTO p VALUES(2); INSERT INTO c VALUES(2);",
            "",
        ),
        ("PRAGMA foreign_keys=ON; DELETE FROM p;", ""),
        (
            "SELECT n FROM log; SELECT count(*) FROM p; SELECT count(*) FROM c;",
            "2\n0\n0\n",
        ),
        (
            "INSERT INTO p VALUES(3); INSERT INTO c VALUES(3); PRAGMA foreign_keys=ON; DELETE FROM p;",
            "",
        ),
        ("SELECT n FROM log ORDER BY n;", "2\n3\n"),
        (
            "SELECT sql FROM sqlite_master ORDER BY name;",
            "CREATE TABLE c(x INT REFERENCES p ON DELETE CASCADE)\nCREATE TABLE log(n)\nCREATE TABLE p(id INTEGER PRIMARY KEY)\n",
        ),
    ] {
        let result = shell
            .exec_with_options(
                "sqlite3 ledger.db",
                ExecOptions {
                    stdin: Some(sql.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            (
                result.exit_code,
                result.stdout.as_str(),
                result.stderr.as_str()
            ),
            (0, expected, ""),
            "{sql}"
        );
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn sqlite_cascade_audits_each_deleted_child_and_preserves_other_rows() {
    let mut shell = shell();
    let result = shell.exec("sqlite3 ledger.db 'CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(x INT REFERENCES p ON DELETE CASCADE); CREATE TABLE log(n); CREATE TRIGGER ac AFTER DELETE ON c BEGIN INSERT INTO log VALUES(OLD.x); END; INSERT INTO p VALUES(1),(2),(3); INSERT INTO c VALUES(1),(2),(2),(3),(NULL); PRAGMA foreign_keys=ON; DELETE FROM p WHERE id=2;'").unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    let result = shell.exec("sqlite3 ledger.db 'SELECT n FROM log; SELECT rowid,x FROM c ORDER BY rowid; SELECT id FROM p ORDER BY id; PRAGMA foreign_keys=OFF; DELETE FROM p; SELECT count(*) FROM log; SELECT count(*) FROM c;'").unwrap();
    assert_eq!(
        (
            result.exit_code,
            result.stdout.as_str(),
            result.stderr.as_str()
        ),
        (0, "2\n2\n1|1\n4|3\n5|\n1\n3\n2\n3\n", "")
    );
}

#[test]
fn sqlite_cascade_audit_failure_rolls_back_parent_children_and_prior_audit_rows() {
    let mut shell = shell();
    let result = shell.exec("sqlite3 ledger.db 'CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(x INT REFERENCES p ON DELETE CASCADE); CREATE TABLE log(n UNIQUE); CREATE TRIGGER ac AFTER DELETE ON c BEGIN INSERT INTO log VALUES(OLD.x); END; INSERT INTO p VALUES(1),(2); INSERT INTO c VALUES(1),(2),(2);'").unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    let result = shell
        .exec("sqlite3 ledger.db 'PRAGMA foreign_keys=ON; DELETE FROM p RETURNING id;'")
        .unwrap();
    assert_ne!(result.exit_code, 0, "{result:?}");
    assert!(result.stdout.is_empty(), "{result:?}");
    assert!(
        result.stderr.contains("UNIQUE constraint failed"),
        "{result:?}"
    );
    let result = shell.exec("sqlite3 ledger.db 'SELECT id FROM p ORDER BY id; SELECT rowid,x FROM c ORDER BY rowid; SELECT count(*) FROM log;'").unwrap();
    assert_eq!(
        (
            result.exit_code,
            result.stdout.as_str(),
            result.stderr.as_str()
        ),
        (0, "1\n2\n1|1\n2|2\n3|2\n0\n", "")
    );
}
