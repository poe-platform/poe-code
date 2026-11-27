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
fn sqlite_delete_rejects_referenced_parent_through_shell_stdin() {
    let result = shell()
        .exec_with_options(
            "sqlite3 :memory: <<'INPUT'\nPRAGMA foreign_keys=ON; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(pid REFERENCES p(id)); INSERT INTO p VALUES(1); INSERT INTO c VALUES(1); DELETE FROM p; SELECT count(*) FROM p;\nINPUT",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 1, "{result:?}");
    assert!(result.stdout.is_empty(), "{result:?}");
    assert!(
        result.stderr.contains("FOREIGN KEY constraint failed"),
        "{result:?}"
    );
    assert!(!result.used_typescript_bridge);
}

#[test]
fn sqlite_delete_restrictions_restore_entire_statement_and_preserve_prior_writes() {
    for declaration in [
        "pid REFERENCES p(id)",
        "pid REFERENCES p(id) ON DELETE NO ACTION",
        "pid REFERENCES p(id) ON DELETE RESTRICT",
        "pid, FOREIGN KEY(pid) REFERENCES p(id) ON DELETE RESTRICT",
        "pid REFERENCES p ON DELETE RESTRICT",
    ] {
        let mut shell = shell();
        let result = shell.exec(&format!(
            "sqlite3 /db 'PRAGMA foreign_keys=ON; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE a(pid REFERENCES p(id) ON DELETE CASCADE); CREATE TABLE c({declaration}); CREATE TABLE log(id); CREATE TRIGGER deleted AFTER DELETE ON p BEGIN INSERT INTO log VALUES(OLD.id); END; INSERT INTO p VALUES(1),(2); INSERT INTO a VALUES(1),(2); INSERT INTO c VALUES(2); DELETE FROM p RETURNING id; SELECT count(*) FROM p;'"
        )).unwrap();
        assert_eq!(result.exit_code, 1, "{declaration}: {result:?}");
        assert!(result.stdout.is_empty(), "{declaration}: {result:?}");
        assert!(
            result.stderr.contains("FOREIGN KEY constraint failed"),
            "{declaration}: {result:?}"
        );
        let preserved = shell.exec("sqlite3 /db 'SELECT id FROM p ORDER BY id; SELECT pid FROM a ORDER BY pid; SELECT pid FROM c; SELECT count(*) FROM log;'").unwrap();
        assert_eq!(
            (
                preserved.exit_code,
                preserved.stdout.as_str(),
                preserved.stderr.as_str()
            ),
            (0, "1\n2\n1\n2\n2\n0\n", ""),
            "{declaration}"
        );
        let allowed = shell.exec("sqlite3 /db 'PRAGMA foreign_keys=ON; DELETE FROM p WHERE id=1 RETURNING id; SELECT id FROM p; SELECT pid FROM a; SELECT pid FROM c; SELECT id FROM log;'").unwrap();
        assert_eq!(
            (
                allowed.exit_code,
                allowed.stdout.as_str(),
                allowed.stderr.as_str()
            ),
            (0, "1\n2\n2\n2\n1\n", ""),
            "{declaration}"
        );
    }
}

#[test]
fn sqlite_delete_preserves_allowed_foreign_key_behavior() {
    for (pragma, action, child_value, expected) in [
        ("OFF", "RESTRICT", "1", "0\n1\n1\n"),
        ("ON", "RESTRICT", "NULL", "0\n1\n\n"),
        ("ON", "CASCADE", "1", "0\n0\n"),
        ("ON", "SET NULL", "1", "0\n1\n\n"),
    ] {
        let result = shell().exec(&format!(
            "sqlite3 :memory: 'PRAGMA foreign_keys={pragma}; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(pid REFERENCES p(id) ON DELETE {action}); INSERT INTO p VALUES(1); INSERT INTO c VALUES({child_value}); DELETE FROM p; SELECT count(*) FROM p; SELECT count(*) FROM c; SELECT pid FROM c;'"
        )).unwrap();
        assert_eq!(
            (
                result.exit_code,
                result.stdout.as_str(),
                result.stderr.as_str()
            ),
            (0, expected, ""),
            "{pragma}, {action}, {child_value}"
        );
    }
}
