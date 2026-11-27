use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::collections::BTreeMap;
use std::sync::Arc;

fn shell() -> Shell {
    Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            cwd: Some("/".into()),
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
        },
    )
}

#[test]
fn sqlite_rowids_survive_deleting_an_earlier_row() {
    let mut shell = shell();
    let output = shell
        .exec_with_options(
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(k TEXT); INSERT INTO t VALUES('a'),('b'),('c'); DELETE FROM t WHERE k='a'; SELECT rowid,k FROM t ORDER BY rowid;\nINPUT",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    assert_eq!(output.stderr, "");
    assert_eq!(output.stdout, "2|b\n3|c\n");
}

#[test]
fn sqlite_rowids_survive_reopening_inserting_updating_and_rollback() {
    let mut shell = shell();
    for (sql, expected) in [
        (
            "CREATE TABLE t(k TEXT); INSERT INTO t VALUES('a'),('b'),('c'); DELETE FROM t WHERE k='a';",
            "",
        ),
        ("SELECT rowid,k FROM t ORDER BY rowid;", "2|b\n3|c\n"),
        (
            "INSERT INTO t VALUES('d'); UPDATE t SET k='B' WHERE k='b'; SELECT x.rowid,x.k FROM t AS x WHERE rowid>1 ORDER BY rowid DESC;",
            "4|d\n3|c\n2|B\n",
        ),
        (
            "BEGIN; DELETE FROM t WHERE k='c'; ROLLBACK; SELECT rowid,k FROM t ORDER BY rowid;",
            "2|B\n3|c\n4|d\n",
        ),
        (
            "DELETE FROM t WHERE k='d'; INSERT INTO t VALUES('e'); SELECT rowid,k FROM t ORDER BY rowid;",
            "2|B\n3|c\n4|e\n",
        ),
        ("SELECT * FROM t ORDER BY rowid DESC;", "e\nc\nB\n"),
        (
            "DELETE FROM t; INSERT INTO t VALUES('f'); SELECT rowid,k FROM t;",
            "1|f\n",
        ),
    ] {
        let output = shell
            .exec_with_options(
                "sqlite3 /rows.db",
                ExecOptions {
                    stdin: Some(sql.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(output.exit_code, 0, "{sql}: {}", output.stderr);
        assert_eq!(output.stderr, "", "{sql}");
        assert_eq!(output.stdout, expected, "{sql}");
    }
}

#[test]
fn sqlite_declared_rowid_and_integer_primary_key_keep_their_meaning() {
    let mut shell = shell();
    for (sql, expected) in [
        (
            "CREATE TABLE t(rowid TEXT,k TEXT); INSERT INTO t VALUES('key-a','a'),('key-b','b'); DELETE FROM t WHERE k='a'; SELECT * FROM t; SELECT rowid,k FROM t;",
            "key-b|b\nkey-b|b\n",
        ),
        (
            "CREATE TABLE t(id INTEGER PRIMARY KEY,k TEXT); INSERT INTO t VALUES(20,'a'),(40,'b'); DELETE FROM t WHERE k='a'; SELECT rowid,id,k FROM t;",
            "40|40|b\n",
        ),
    ] {
        let output = shell
            .exec_with_options(
                "sqlite3 :memory:",
                ExecOptions {
                    stdin: Some(sql.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(output.exit_code, 0, "{sql}: {}", output.stderr);
        assert_eq!(output.stdout, expected, "{sql}");
    }
}

#[test]
fn sqlite_cascaded_deletion_preserves_surviving_child_rowids() {
    let mut shell = shell();
    let output = shell.exec_with_options(
        "sqlite3 :memory:",
        ExecOptions {
            stdin: Some("PRAGMA foreign_keys=ON; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(pid INTEGER REFERENCES p(id) ON DELETE CASCADE,k TEXT); INSERT INTO p VALUES(1),(2); INSERT INTO c VALUES(1,'a'),(2,'b'),(2,'c'); DELETE FROM p WHERE id=1; SELECT rowid,k FROM c ORDER BY rowid;".into()),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    assert_eq!(output.stdout, "2|b\n3|c\n");
}

#[test]
fn sqlite_import_allocates_rowids_after_deletions() {
    let mut shell = shell();
    let output = shell.exec_with_options(
        "printf 'k\\na\\nb\\nc\\n' > /rows.csv\nsqlite3 /import.db <<'SQL'\n.import --csv /rows.csv t\nDELETE FROM t WHERE k='a';\nSQL\nprintf 'd\\n' > /more.csv\nsqlite3 /import.db <<'SQL'\n.import --csv /more.csv t\nSELECT rowid,k FROM t ORDER BY rowid;\nSQL",
        ExecOptions::default(),
    ).unwrap();
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    assert_eq!(output.stdout, "2|b\n3|c\n4|d\n");
}

#[test]
fn sqlite_replace_preserves_other_rows_identities() {
    let mut shell = shell();
    let output = shell
        .exec_with_options(
            "sqlite3 :memory:",
            ExecOptions {
                stdin: Some("CREATE TABLE t(k TEXT UNIQUE); INSERT INTO t VALUES('a'),('b'),('c'); INSERT OR REPLACE INTO t VALUES('a'); SELECT rowid,k FROM t ORDER BY rowid;".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    assert_eq!(output.stdout, "2|b\n3|c\n4|a\n");
}
