use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_index_catalog() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(n); CREATE INDEX by_n ON t(n); SELECT name FROM sqlite_master WHERE type='index';\nINPUT",
        ExecOptions {
            cwd: Some("/".into()),
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "by_n\n");
}

#[test]
fn sqlite_index_catalog_survives_reopening_and_drop() {
    let (mut shell, _) = Shell::with_memory_fs();
    for (sql, expected) in [
        (
            "CREATE TABLE a(x); CREATE TABLE t(n,m); CREATE INDEX by_m ON t(m DESC); CREATE UNIQUE INDEX by_n ON t(n);",
            "",
        ),
        (
            "SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='index' ORDER BY name;",
            "by_m|t|CREATE INDEX by_m ON t(m DESC)\nby_n|t|CREATE UNIQUE INDEX by_n ON t(n)\n",
        ),
        (
            "DROP INDEX by_m; SELECT name FROM sqlite_master WHERE type='index';",
            "by_n\n",
        ),
        (
            "SELECT name FROM sqlite_master WHERE type='index';",
            "by_n\n",
        ),
    ] {
        let result = shell
            .exec(&format!("sqlite3 /catalog.db <<'INPUT'\n{sql}\nINPUT"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stderr, "");
        assert_eq!(result.stdout, expected, "{sql}");
    }
}

#[test]
fn sqlite_rolled_back_index_is_absent_after_reopening() {
    let (mut shell, _) = Shell::with_memory_fs();
    for (sql, expected) in [
        (
            "CREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE,v INT CHECK(v>=0)); INSERT INTO t VALUES(1,1,10),(2,2,20),(3,3,30);",
            "",
        ),
        ("BEGIN; CREATE INDEX idx ON t(v); ROLLBACK;", ""),
        (
            "SELECT name FROM sqlite_master WHERE name='idx'; SELECT * FROM t ORDER BY id;",
            "1|1|10\n2|2|20\n3|3|30\n",
        ),
    ] {
        let result = shell
            .exec_with_options(
                &format!("sqlite3 ledger.db <<'INPUT'\n{sql}\nINPUT"),
                ExecOptions {
                    cwd: Some("/".into()),
                    env: BTreeMap::from([
                        ("LC_ALL".into(), "C".into()),
                        ("TZ".into(), "UTC".into()),
                    ]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{sql}: {result:?}");
        assert_eq!(result.stderr, "");
        assert_eq!(result.stdout, expected, "{sql}");
    }
}

#[test]
fn sqlite_index_catalog_tracks_transaction_and_savepoint_outcomes() {
    for (begin, ending, committed) in [
        ("BEGIN", "ROLLBACK", false),
        ("BEGIN", "", false),
        ("SAVEPOINT outer", "ROLLBACK", false),
        ("SAVEPOINT outer", "", false),
        ("SAVEPOINT outer", "ROLLBACK TO outer; RELEASE outer", false),
        (
            "BEGIN; SAVEPOINT inner",
            "ROLLBACK TO SAVEPOINT inner; RELEASE inner; COMMIT",
            false,
        ),
        ("BEGIN", "COMMIT", true),
        ("BEGIN", "END TRANSACTION", true),
        ("SAVEPOINT outer", "RELEASE outer", true),
        ("BEGIN; SAVEPOINT inner", "RELEASE inner; COMMIT", true),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec("sqlite3 /catalog.db 'CREATE TABLE t(n); INSERT INTO t VALUES(1); CREATE UNIQUE INDEX original ON t(n);'").unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let change = shell.exec(&format!("sqlite3 /catalog.db '{begin}; DROP INDEX original; CREATE UNIQUE INDEX replacement ON t(n DESC); UPDATE t SET n=2; {ending};'")).unwrap();
        assert_eq!(change.exit_code, 0, "{begin}; {ending}: {change:?}");
        assert_eq!(change.stderr, "");
        assert_eq!(change.stdout, "");
        let reopened = shell.exec("sqlite3 /catalog.db \"SELECT name,tbl_name,sql FROM sqlite_master WHERE type='index'; SELECT n FROM t;\"").unwrap();
        assert_eq!(reopened.exit_code, 0, "{reopened:?}");
        assert_eq!(reopened.stderr, "");
        assert_eq!(
            reopened.stdout,
            if committed {
                "replacement|t|CREATE UNIQUE INDEX replacement ON t(n DESC)\n2\n"
            } else {
                "original|t|CREATE UNIQUE INDEX original ON t(n)\n1\n"
            },
            "{begin}; {ending}",
        );
        let duplicate = shell
            .exec("sqlite3 /catalog.db 'INSERT INTO t SELECT n FROM t;'")
            .unwrap();
        assert_ne!(duplicate.exit_code, 0, "{begin}; {ending}: {duplicate:?}");
        assert!(duplicate.stderr.contains("UNIQUE constraint failed"));
    }
}

#[test]
fn sqlite_index_rollback_keeps_outer_changes_and_allows_reusing_index_name() {
    let (mut shell, _) = Shell::with_memory_fs();
    let changed = shell.exec("sqlite3 /catalog.db <<'INPUT'\nCREATE TABLE t(n,m); BEGIN; CREATE INDEX outer_idx ON t(n); SAVEPOINT inner; DROP INDEX outer_idx; CREATE INDEX idx ON t(n); SAVEPOINT nested; CREATE INDEX nested_idx ON t(m); ROLLBACK TO inner;\n.indexes\nCREATE INDEX idx ON t(m DESC); ROLLBACK TO inner;\n.indexes\nCREATE INDEX idx ON t(m DESC); RELEASE inner; COMMIT;\nINPUT").unwrap();
    assert_eq!(changed.exit_code, 0, "{changed:?}");
    assert_eq!(changed.stderr, "");
    assert_eq!(changed.stdout, "outer_idx\nouter_idx\n");
    let reopened = shell.exec("sqlite3 /catalog.db \"SELECT name,sql FROM sqlite_master WHERE type='index' ORDER BY name;\"").unwrap();
    assert_eq!(reopened.exit_code, 0, "{reopened:?}");
    assert_eq!(reopened.stderr, "");
    assert_eq!(
        reopened.stdout,
        "idx|CREATE INDEX idx ON t(m DESC)\nouter_idx|CREATE INDEX outer_idx ON t(n)\n"
    );
}
