use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_deferred_foreign_keys_allow_child_before_parent() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: <<'INPUT'\nPRAGMA foreign_keys=ON; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(id REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED); BEGIN; INSERT INTO c VALUES(7); INSERT INTO p VALUES(7); COMMIT; SELECT id FROM c;\nINPUT",
        ExecOptions {
            cwd: Some("/".into()),
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "7\n");
    assert_eq!(result.stderr, "");
}

#[test]
fn sqlite_deferred_foreign_keys_check_transaction_boundaries() {
    for (clause, statements, succeeds) in [
        (
            "DEFERRABLE INITIALLY DEFERRED",
            "BEGIN; INSERT INTO c VALUES(7); COMMIT;",
            false,
        ),
        (
            "DEFERRABLE INITIALLY DEFERRED",
            "INSERT INTO c VALUES(7);",
            false,
        ),
        (
            "DEFERRABLE INITIALLY IMMEDIATE",
            "BEGIN; INSERT INTO c VALUES(7); INSERT INTO p VALUES(7); COMMIT;",
            false,
        ),
        (
            "NOT DEFERRABLE INITIALLY DEFERRED",
            "BEGIN; INSERT INTO c VALUES(7); INSERT INTO p VALUES(7); COMMIT;",
            false,
        ),
        (
            "DEFERRABLE INITIALLY DEFERRED",
            "BEGIN; INSERT INTO c VALUES(7); ROLLBACK;",
            true,
        ),
        (
            "DEFERRABLE INITIALLY DEFERRED",
            "BEGIN; INSERT INTO c VALUES(NULL); COMMIT;",
            true,
        ),
        (
            "DEFERRABLE INITIALLY DEFERRED",
            "BEGIN; INSERT INTO c VALUES(7); DELETE FROM c; END;",
            true,
        ),
        (
            "DEFERRABLE INITIALLY DEFERRED",
            "SAVEPOINT outer; INSERT INTO c VALUES(7); INSERT INTO p VALUES(7); RELEASE outer;",
            true,
        ),
        (
            "DEFERRABLE INITIALLY DEFERRED",
            "SAVEPOINT outer; INSERT INTO c VALUES(7); RELEASE outer;",
            false,
        ),
        (
            "DEFERRABLE INITIALLY DEFERRED",
            "BEGIN; SAVEPOINT inner; INSERT INTO c VALUES(7); RELEASE inner; INSERT INTO p VALUES(7); END TRANSACTION;",
            true,
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "sqlite3 :memory: <<'SQL'\nPRAGMA foreign_keys=ON; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(id, FOREIGN KEY(id) REFERENCES p(id) {clause}); {statements}\nSQL"
        )).unwrap();
        assert_eq!(
            result.exit_code,
            i32::from(!succeeds),
            "{clause}: {statements}: {}",
            result.stderr
        );
        assert_eq!(
            result.stderr,
            if succeeds {
                ""
            } else {
                "Error: FOREIGN KEY constraint failed\n"
            }
        );
    }
}

#[test]
fn sqlite_deferred_foreign_keys_survive_database_reopening() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /deferred.db 'CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(id REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED);'").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let result = shell.exec("sqlite3 /deferred.db 'PRAGMA foreign_keys=ON; BEGIN; INSERT INTO c VALUES(7); INSERT INTO p VALUES(7); COMMIT; SELECT id FROM c;'").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "7\n");
}

#[test]
fn sqlite_failed_deferred_commit_does_not_persist_invalid_rows() {
    let (mut shell, _) = Shell::with_memory_fs();
    assert_eq!(shell.exec("sqlite3 /invalid.db 'CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(id REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED);'").unwrap().exit_code, 0);
    let result = shell
        .exec(
            "sqlite3 /invalid.db 'PRAGMA foreign_keys=ON; BEGIN; INSERT INTO c VALUES(7); COMMIT;'",
        )
        .unwrap();
    assert_eq!(result.exit_code, 1);
    assert_eq!(result.stderr, "Error: FOREIGN KEY constraint failed\n");
    let result = shell
        .exec("sqlite3 /invalid.db 'SELECT count(*) FROM c;'")
        .unwrap();
    assert_eq!(result.stdout, "0\n");
}

#[test]
fn sqlite_deferred_parent_delete_can_be_repaired_before_commit() {
    for (action, succeeds) in [("NO ACTION", true), ("RESTRICT", false)] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!("sqlite3 :memory: <<'SQL'\nPRAGMA foreign_keys=ON; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(id REFERENCES p(id) ON DELETE {action} DEFERRABLE INITIALLY DEFERRED); INSERT INTO p VALUES(7); INSERT INTO c VALUES(7); BEGIN; DELETE FROM p; INSERT INTO p VALUES(7); COMMIT; SELECT id FROM c;\nSQL")).unwrap();
        assert_eq!(
            result.exit_code,
            i32::from(!succeeds),
            "{action}: {}",
            result.stderr
        );
        if succeeds {
            assert_eq!(result.stdout, "7\n");
        }
    }
}

#[test]
fn sqlite_uncommitted_deferred_rows_are_rolled_back_on_close() {
    for begin in ["BEGIN", "SAVEPOINT outer"] {
        let (mut shell, _) = Shell::with_memory_fs();
        assert_eq!(shell.exec("sqlite3 /uncommitted.db 'CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(id REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED);'").unwrap().exit_code, 0);
        let result = shell.exec(&format!("sqlite3 /uncommitted.db 'PRAGMA foreign_keys=ON; {begin}; INSERT INTO c VALUES(7);'")).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let result = shell
            .exec("sqlite3 /uncommitted.db 'SELECT count(*) FROM c;'")
            .unwrap();
        assert_eq!(result.stdout, "0\n", "{begin}");
    }
}

#[test]
fn sqlite_releasing_outer_savepoint_checks_deferred_constraints_with_nested_savepoints() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: 'PRAGMA foreign_keys=ON; CREATE TABLE p(id PRIMARY KEY); CREATE TABLE c(id REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED); SAVEPOINT outer; SAVEPOINT inner; INSERT INTO c VALUES(7); RELEASE outer;'").unwrap();
    assert_eq!(result.exit_code, 1);
    assert_eq!(result.stderr, "Error: FOREIGN KEY constraint failed\n");
}
