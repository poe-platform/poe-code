use safe_bash_rust::{ExecOptions, Shell};

#[test]
fn sqlite_update_enforces_check_constraints_through_shell() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(n INTEGER CHECK(n>0)); INSERT INTO t VALUES(1); UPDATE t SET n=-8; SELECT n FROM t;\nINPUT",
        ExecOptions { cwd: Some("/".into()), env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(), ..Default::default() },
    ).unwrap();
    assert_eq!(result.exit_code, 1, "{result:?}");
    assert_eq!(result.stdout, "");
    assert!(
        result.stderr.contains("CHECK constraint failed: n>0"),
        "{result:?}"
    );
}

#[test]
fn sqlite_failed_updates_preserve_stored_rows() {
    for update in [
        "UPDATE t SET n=n-2 RETURNING n",
        "WITH source(n) AS (VALUES (1)) UPDATE t SET n=-8",
        "CREATE TRIGGER bad BEFORE UPDATE ON t WHEN NEW.n>0 BEGIN UPDATE t SET n=-8; END; UPDATE t SET n=n+1",
        "CREATE TRIGGER bad AFTER UPDATE ON t WHEN NEW.n>0 BEGIN UPDATE t SET n=-8; END; UPDATE t SET n=n+1",
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell
            .exec(
                "sqlite3 /db 'CREATE TABLE t(n INTEGER CHECK(n>0)); INSERT INTO t VALUES(3),(1);'",
            )
            .unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell.exec(&format!("sqlite3 /db '{update}'")).unwrap();
        assert_eq!(result.exit_code, 1, "{update}: {result:?}");
        assert_eq!(result.stdout, "");
        assert!(
            result.stderr.contains("CHECK constraint failed: n>0"),
            "{result:?}"
        );
        let stored = shell.exec("sqlite3 /db 'SELECT n FROM t'").unwrap();
        assert_eq!(stored.stdout, "3\n1\n", "{update}");
        let valid = shell
            .exec("sqlite3 /db 'UPDATE t SET n=n+1 RETURNING n'")
            .unwrap();
        assert_eq!(valid.exit_code, 0, "{valid:?}");
        assert_eq!(valid.stdout, "4\n2\n");
    }
}
