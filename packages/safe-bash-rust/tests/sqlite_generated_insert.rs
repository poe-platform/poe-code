use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_rejects_explicit_generated_insert_columns() {
    for insert in [
        "INSERT INTO t(a,b) VALUES(2,100)",
        "INSERT OR IGNORE INTO t(a,b) VALUES(2,100)",
        "REPLACE INTO t(a,b) VALUES(2,100)",
        "INSERT INTO t(a,\"B\") VALUES(2,100)",
        "INSERT INTO t(a,b) SELECT 2,100 WHERE 0",
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec_with_options(
            &format!("sqlite3 :memory: 'CREATE TABLE t(a INT,b INT GENERATED ALWAYS AS(a+1));{insert};SELECT * FROM t;'"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        ).unwrap();
        assert_eq!(result.exit_code, 1, "{insert}: {result:?}");
        assert!(result.stdout.is_empty(), "{insert}: {result:?}");
        assert_eq!(
            result.stderr, "Error: in prepare, cannot INSERT into generated column \"b\"\n",
            "{insert}"
        );
    }
}

#[test]
fn sqlite_generated_insert_failure_leaves_existing_rows_unchanged() {
    let (mut shell, _) = Shell::with_memory_fs();
    let setup = shell.exec("sqlite3 /test.db 'CREATE TABLE t(a INT,b INT GENERATED ALWAYS AS(a+1));INSERT INTO t(a) VALUES(1);'").unwrap();
    assert_eq!(setup.exit_code, 0, "{setup:?}");
    let rejected = shell
        .exec("sqlite3 /test.db 'INSERT INTO t(a,b) VALUES(2,100),(3,200);'")
        .unwrap();
    assert_eq!(rejected.exit_code, 1, "{rejected:?}");
    let rows = shell.exec("sqlite3 /test.db 'SELECT * FROM t;'").unwrap();
    assert_eq!(rows.exit_code, 0, "{rows:?}");
    assert_eq!(rows.stdout, "1|2\n");
}
