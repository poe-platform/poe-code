use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn implicit_rowids_survive_deletion_through_shell() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
        },
    );
    let result = shell.exec_with_options(
        "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(k TEXT); INSERT INTO t VALUES('a'),('b'),('c'); DELETE FROM t WHERE k='a'; SELECT rowid,k FROM t ORDER BY rowid;\nINPUT",
        ExecOptions::default(),
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "2|b\n3|c\n");
}

#[test]
fn row_identity_survives_mutations_and_database_reload() {
    for (setup, query, expected) in [
        (
            "CREATE TABLE t(k TEXT); INSERT INTO t VALUES('a'),('b'),('c'); DELETE FROM t WHERE k='a'; INSERT INTO t VALUES('d');",
            "SELECT rowid,k FROM t ORDER BY rowid DESC; SELECT * FROM t;",
            "4|d\n3|c\n2|b\nb\nc\nd\n",
        ),
        (
            "CREATE TABLE t(k TEXT UNIQUE); INSERT INTO t VALUES('a'),('b'),('c'); REPLACE INTO t VALUES('a'); REPLACE INTO t VALUES('a');",
            "SELECT rowid,k FROM t ORDER BY rowid;",
            "2|b\n3|c\n5|a\n",
        ),
        (
            "PRAGMA foreign_keys=ON; CREATE TABLE p(k TEXT PRIMARY KEY); CREATE TABLE t(k TEXT REFERENCES p(k) ON DELETE CASCADE); INSERT INTO p VALUES('a'),('b'),('c'); INSERT INTO t VALUES('a'),('b'),('c'); DELETE FROM p WHERE k='a';",
            "SELECT rowid,k FROM t ORDER BY rowid;",
            "2|b\n3|c\n",
        ),
        (
            "CREATE TABLE t(k TEXT); INSERT INTO t VALUES('a'),('b'),('c'); DELETE FROM t; INSERT INTO t VALUES('d');",
            "SELECT rowid,k FROM t;",
            "1|d\n",
        ),
        (
            "CREATE TABLE t(k TEXT); INSERT INTO t VALUES('a'),('b'),('c'); DELETE FROM t WHERE k='c'; INSERT INTO t VALUES('d');",
            "SELECT rowid,k FROM t WHERE rowid > 1 ORDER BY rowid;",
            "2|b\n3|d\n",
        ),
        (
            "CREATE TABLE t(k TEXT); INSERT INTO t VALUES('a'),('b'),('c'); BEGIN; DELETE FROM t WHERE k='a'; ROLLBACK; UPDATE t SET k='d' WHERE k='b';",
            "SELECT rowid,k FROM t AS x ORDER BY rowid;",
            "1|a\n2|d\n3|c\n",
        ),
        (
            "CREATE TABLE t(id INTEGER PRIMARY KEY,k TEXT); INSERT INTO t VALUES(-4,'a'),(9,'b');",
            "SELECT rowid,k FROM t ORDER BY rowid;",
            "-4|a\n9|b\n",
        ),
        (
            "CREATE TABLE t(id INTEGER PRIMARY KEY,k TEXT); INSERT INTO t VALUES(9223372036854775807,'a');",
            "INSERT INTO t VALUES(2,'b'); SELECT rowid,k FROM t ORDER BY rowid;",
            "2|b\n9223372036854775807|a\n",
        ),
        (
            "CREATE TABLE t(rowid TEXT,k TEXT); INSERT INTO t VALUES('custom','a');",
            "SELECT rowid,k FROM t;",
            "custom|a\n",
        ),
    ] {
        for persisted in [false, true] {
            let mut shell = Shell::new(
                Arc::new(MemoryVfs::new()),
                ShellOptions {
                    cwd: Some("/".into()),
                    mode: BackendMode::NativeOnly,
                    ..Default::default()
                },
            );
            let script = if persisted {
                format!(
                    "sqlite3 /test.db <<'INPUT'\n{setup}\nINPUT\nsqlite3 /test.db <<'INPUT'\n{query}\nINPUT"
                )
            } else {
                format!("sqlite3 :memory: <<'INPUT'\n{setup} {query}\nINPUT")
            };
            let result = shell
                .exec_with_options(&script, ExecOptions::default())
                .unwrap();
            assert_eq!(result.exit_code, 0, "{script}: {}", result.stderr);
            assert_eq!(result.stderr, "", "{script}");
            assert_eq!(result.stdout, expected, "{script}");
        }
    }
}
