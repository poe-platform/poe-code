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
fn sqlite_composite_primary_key_rejects_duplicate_tuple_through_shell() {
    let result = shell()
        .exec_with_options(
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(a,b,PRIMARY KEY(a,b)); INSERT INTO t VALUES(1,1),(1,2),(1,1); SELECT count(*) FROM t;\nINPUT",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 1, "{result:?}");
    assert_eq!(result.stdout, "");
    assert!(
        result.stderr.contains("UNIQUE constraint failed: t.a, t.b"),
        "{result:?}"
    );
}

#[test]
fn sqlite_composite_primary_key_persists_and_rolls_back_only_failed_insert() {
    for key in ["PRIMARY KEY(a,b)", "CONSTRAINT pair PRIMARY KEY(b,a)"] {
        let mut shell = shell();
        let setup = shell
            .exec(&format!(
                "sqlite3 /db \"CREATE TABLE t(a,b,{key}); INSERT INTO t VALUES(1,1),(1,2);\""
            ))
            .unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell.exec(
            "sqlite3 /db \"INSERT INTO t VALUES(2,1); INSERT INTO t VALUES(3,1),(1,1); SELECT count(*) FROM t;\""
        ).unwrap();
        assert_eq!(result.exit_code, 1, "{key}: {result:?}");
        assert_eq!(result.stdout, "");
        assert!(
            result.stderr.contains("UNIQUE constraint failed:"),
            "{result:?}"
        );
        let rows = shell
            .exec("sqlite3 /db 'SELECT * FROM t ORDER BY a,b;'")
            .unwrap();
        assert_eq!(rows.exit_code, 0, "{rows:?}");
        assert_eq!(rows.stdout, "1|1\n1|2\n2|1\n", "{key}");
    }
}

#[test]
fn sqlite_composite_primary_key_conflict_actions_compare_whole_tuple() {
    for (action, expected) in [
        ("OR IGNORE", "1|1|old\n1|2|other\n2|1|new\n"),
        ("OR REPLACE", "1|1|replacement\n1|2|other\n2|1|new\n"),
    ] {
        let result = shell().exec(&format!(
            "sqlite3 :memory: \"CREATE TABLE t(a,b,value,PRIMARY KEY(a,b)); INSERT INTO t VALUES(1,1,'old'); INSERT {action} INTO t VALUES(1,2,'other'),(2,1,'new'),(1,1,'replacement'); SELECT * FROM t ORDER BY a,b;\""
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{result:?}");
        assert_eq!(result.stdout, expected, "{action}");
    }
}

#[test]
fn sqlite_composite_primary_key_allows_null_components() {
    let result = shell().exec(
        "sqlite3 :memory: 'CREATE TABLE t(a,b,PRIMARY KEY(a,b)); INSERT INTO t VALUES(NULL,1),(NULL,1),(1,NULL),(1,NULL); SELECT count(*) FROM t;'"
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "4\n");
}

#[test]
fn sqlite_composite_primary_key_rolls_back_insert_select_and_trigger_rows() {
    let mut shell = shell();
    let setup = shell.exec(
        "sqlite3 /db \"CREATE TABLE t(a,b,PRIMARY KEY(a,b)); CREATE TABLE audit(a,b); CREATE TRIGGER log AFTER INSERT ON t BEGIN INSERT INTO audit VALUES(NEW.a,NEW.b); END; INSERT INTO t VALUES(1,1);\""
    ).unwrap();
    assert_eq!(setup.exit_code, 0, "{setup:?}");
    let result = shell.exec(
        "sqlite3 /db 'WITH source(a,b) AS (VALUES(1,2),(1,1)) INSERT INTO t SELECT * FROM source;'"
    ).unwrap();
    assert_eq!(result.exit_code, 1, "{result:?}");
    assert!(
        result.stderr.contains("UNIQUE constraint failed: t.a, t.b"),
        "{result:?}"
    );
    let rows = shell
        .exec("sqlite3 /db 'SELECT * FROM t; SELECT * FROM audit; .tables source'")
        .unwrap();
    assert_eq!(rows.exit_code, 0, "{rows:?}");
    assert_eq!(rows.stdout, "1|1\n1|1\n");
}
