use safe_bash_rust::{ExecOptions, Shell};

#[test]
fn sqlite_unique_expression_index_rejects_duplicate_keys_through_shell() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: \"CREATE TABLE t(v);CREATE UNIQUE INDEX idx ON t(lower(v));INSERT INTO t VALUES('Ada'),('ADA');SELECT v FROM t;\"",
        ExecOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(result.exit_code, 19, "{result:?}");
    assert_eq!(
        result.stderr,
        "Error: stepping, UNIQUE constraint failed: index 'idx' (19)\n"
    );
    assert_eq!(result.stdout, "");
}

#[test]
fn sqlite_expression_indexes_preserve_complete_terms_and_null_keys_after_reopening() {
    for terms in ["lower( v ) DESC, n + 1", "substr(v, 1, 1), n + 1"] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec(&format!(
            "sqlite3 /db \"CREATE TABLE t(v,n);CREATE UNIQUE INDEX idx ON t({terms});INSERT INTO t VALUES('ada',1),('amy',2),(NULL,1),(NULL,1);\""
        )).unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell
            .exec("sqlite3 /db \"INSERT INTO t VALUES('bob',3),('ada',1) RETURNING v;\"")
            .unwrap();
        assert_eq!(result.exit_code, 19, "{terms}: {result:?}");
        assert_eq!(result.stdout, "");
        assert!(
            result
                .stderr
                .contains("UNIQUE constraint failed: index 'idx'")
        );
        let stored = shell.exec("sqlite3 /db 'SELECT count(*) FROM t;'").unwrap();
        assert_eq!(stored.stdout, "4\n", "{stored:?}");
    }
}

#[test]
fn sqlite_expression_index_creation_rejects_existing_duplicate_keys() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /db \"CREATE TABLE t(v);INSERT INTO t VALUES('Ada'),('ADA');CREATE UNIQUE INDEX idx ON t(lower(v));SELECT v FROM t;\"").unwrap();
    assert_eq!(result.exit_code, 19, "{result:?}");
    assert_eq!(result.stdout, "");
    assert!(
        result
            .stderr
            .contains("UNIQUE constraint failed: index 'idx'")
    );
    let stored = shell
        .exec("sqlite3 /db \"SELECT v FROM t;SELECT name FROM sqlite_master WHERE type='index';\"")
        .unwrap();
    assert_eq!(stored.stdout, "Ada\nADA\n", "{stored:?}");
}

#[test]
fn sqlite_expression_index_updates_roll_back_rows_and_triggers() {
    for update in [
        "CREATE TRIGGER bad AFTER INSERT ON source BEGIN UPDATE t SET v='ADA';END; INSERT INTO source VALUES(1)",
        "UPDATE t SET v='ADA' RETURNING v",
        "WITH src(v) AS (VALUES('ADA')) UPDATE t SET v='ADA'",
        "INSERT INTO t VALUES('ADA') ON CONFLICT DO UPDATE SET v='BOB'",
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec("sqlite3 /db \"CREATE TABLE t(v);CREATE UNIQUE INDEX idx ON t(lower(v));INSERT INTO t VALUES('Ada'),('Bob');CREATE TABLE audit(v);CREATE TABLE source(v);CREATE TRIGGER log AFTER UPDATE ON t BEGIN INSERT INTO audit VALUES(NEW.v);END;\"").unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell
            .exec(&format!("sqlite3 /db \"{update};SELECT v FROM t;\""))
            .unwrap();
        assert_eq!(result.exit_code, 19, "{update}: {result:?}");
        assert_eq!(result.stdout, "");
        assert!(
            result
                .stderr
                .contains("UNIQUE constraint failed: index 'idx'")
        );
        let stored = shell
            .exec("sqlite3 /db 'SELECT v FROM t;SELECT count(*) FROM audit;SELECT count(*) FROM source;'")
            .unwrap();
        assert_eq!(stored.stdout, "Ada\nBob\n0\n0\n", "{update}: {stored:?}");
    }
}

#[test]
fn sqlite_expression_index_conflict_actions_and_drop() {
    for (action, expected) in [("OR IGNORE", "Ada\nBob\n"), ("OR REPLACE", "ADA\nBob\n")] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!("sqlite3 /db \"CREATE TABLE t(v);CREATE UNIQUE INDEX idx ON t(lower(v));INSERT INTO t VALUES('Ada');INSERT {action} INTO t VALUES('ADA'),('Bob');UPDATE t SET v=v;SELECT v FROM t ORDER BY v;\"")).unwrap();
        assert_eq!(result.exit_code, 0, "{result:?}");
        assert_eq!(result.stderr, "");
        assert_eq!(result.stdout, expected);
        let dropped = shell.exec("sqlite3 /db \"DROP INDEX idx;INSERT INTO t VALUES('ada');SELECT count(*) FROM t;\"").unwrap();
        assert_eq!(dropped.exit_code, 0, "{dropped:?}");
        assert_eq!(dropped.stdout, "3\n");
    }
}
