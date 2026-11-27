use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn sqlite_view_triggers_use_new_and_old_rows_and_survive_reopening() {
    let (mut shell, _) = Shell::with_memory_fs();
    let setup = shell
        .exec(
            r#"sqlite3 /views.db '
        CREATE TABLE t(n, label);
        CREATE VIEW v AS SELECT n, label FROM t;
        CREATE TRIGGER ins INSTEAD OF INSERT ON v WHEN NEW.n > 0
        BEGIN INSERT INTO t VALUES(NEW.n, NEW.label); END;
        CREATE TRIGGER upd INSTEAD OF UPDATE ON v
        BEGIN UPDATE t SET n = NEW.n, label = NEW.label WHERE n = OLD.n; END;
        CREATE TRIGGER del INSTEAD OF DELETE ON v
        BEGIN DELETE FROM t WHERE n = OLD.n; END;
    '"#,
        )
        .unwrap();
    assert_eq!((setup.exit_code, setup.stderr.as_str()), (0, ""));
    for (sql, expected) in [
        (
            "INSERT INTO v(label,n) VALUES ('six',6),('skip',0),('seven',7); SELECT * FROM t ORDER BY n;",
            "6|six\n7|seven\n",
        ),
        (
            "UPDATE v SET n = n + 10 WHERE n = 6; SELECT * FROM v ORDER BY n;",
            "7|seven\n16|six\n",
        ),
        ("DELETE FROM v WHERE n = 7; SELECT * FROM t;", "16|six\n"),
    ] {
        let result = shell.exec(&format!("sqlite3 /views.db \"{sql}\"")).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stderr, "");
        assert_eq!(result.stdout, expected, "{sql}");
    }
}

#[test]
fn sqlite_view_insert_triggers_can_write_other_views_and_ignore_rows() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec(
            r#"sqlite3 :memory: '
        CREATE TABLE t(n);
        CREATE VIEW v AS SELECT n FROM t;
        CREATE VIEW outer_v AS SELECT n FROM v;
        CREATE TRIGGER ins INSTEAD OF INSERT ON v BEGIN
            SELECT CASE WHEN NEW.n = 0 THEN RAISE(IGNORE) END;
            INSERT INTO t VALUES(NEW.n);
        END;
        CREATE TRIGGER outer_ins INSTEAD OF INSERT ON outer_v
        BEGIN INSERT INTO v VALUES(NEW.n); END;
        INSERT INTO outer_v VALUES(0),(6),(7);
        SELECT n FROM t ORDER BY n;
    '"#,
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "6\n7\n");
}

#[test]
fn sqlite_instead_of_insert_trigger_writes_to_backing_table() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell.exec_with_options(
        "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(n); CREATE VIEW v AS SELECT n FROM t; CREATE TRIGGER tr INSTEAD OF INSERT ON v BEGIN INSERT INTO t VALUES(NEW.n); END; INSERT INTO v VALUES(6); SELECT n FROM t;\nINPUT",
        ExecOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "6\n");
    assert!(!result.used_typescript_bridge);
}

#[test]
fn sqlite_insert_into_view_without_insert_trigger_is_rejected() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: 'CREATE TABLE t(n); CREATE VIEW v AS SELECT n FROM t; INSERT INTO v VALUES(6);'").unwrap();
    assert_eq!(result.exit_code, 1);
    assert_eq!(result.stdout, "");
    assert_eq!(
        result.stderr,
        "Error: cannot modify v because it is a view\n"
    );
}
