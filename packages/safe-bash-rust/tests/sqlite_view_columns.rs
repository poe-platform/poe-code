use safe_bash_rust::{ExecOptions, SafeBashFs, Shell};
use std::io::Write;
use std::process::{Command, Stdio};

// Python's SQLite reads/writes real database bytes independently of Safe Bash.
// Both engines keep their databases in memory throughout the test.
fn sqlite_python(script: &str, input: &[u8]) -> Vec<u8> {
    let mut child = Command::new("python3")
        .args(["-c", script])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("python3 with SQLite serialization support");
    child.stdin.take().unwrap().write_all(input).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[test]
fn sqlite_rewrite_preserves_imported_view_declarations() {
    let sql = r#"CREATE TABLE t(k,v); INSERT INTO t VALUES(2,'hi');
CREATE VIEW v(k,n) AS SELECT k,v FROM t;
CREATE VIEW plain AS SELECT k,v FROM t;"#;
    let original = sqlite_python(
        "import sqlite3, sys\ndb = sqlite3.connect(':memory:')\ndb.executescript(sys.stdin.read())\nsys.stdout.buffer.write(db.serialize())",
        sql.as_bytes(),
    );
    let (mut shell, fs) = Shell::with_memory_fs();
    fs.write_file("/records.db", &original).unwrap();
    for statement in [
        "CREATE TABLE separate(note TEXT); INSERT INTO separate VALUES(7);",
        "INSERT INTO separate VALUES(8);",
    ] {
        let result = shell
            .exec_with_options(
                "sqlite3 /records.db",
                ExecOptions {
                    stdin: Some(statement.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
        assert!(!result.used_typescript_bridge);
        sqlite_python(
            r#"import sqlite3, sys
db = sqlite3.connect(':memory:')
db.deserialize(sys.stdin.buffer.read())
assert db.execute('SELECT k,n FROM v').fetchall() == [(2, 'hi')]
assert db.execute('SELECT k,v FROM plain').fetchall() == [(2, 'hi')]
assert db.execute('SELECT k,v FROM t').fetchall() == [(2, 'hi')]
assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
"#,
            &fs.read_file("/records.db").unwrap(),
        );
    }
    let query = shell
        .exec("sqlite3 /records.db 'SELECT k,n FROM v;'")
        .unwrap();
    assert_eq!((query.exit_code, query.stderr.as_str()), (0, ""));
    assert_eq!(query.stdout, "2|hi\n");
}

#[test]
fn sqlite_created_view_columns_survive_reopening() {
    let (mut shell, fs) = Shell::with_memory_fs();
    let result = shell.exec_with_options("sqlite3 /records.db", ExecOptions {
        stdin: Some("CREATE TABLE t(k,v); INSERT INTO t VALUES(2,'hi'); CREATE VIEW IF NOT EXISTS v(k, n) AS SELECT k,v FROM t; SELECT k,n FROM v;".into()),
        ..Default::default()
    }).unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    assert_eq!(result.stdout, "2|hi\n");
    let reopened = shell
        .exec("sqlite3 /records.db 'SELECT k,n FROM v;'")
        .unwrap();
    assert_eq!((reopened.exit_code, reopened.stderr.as_str()), (0, ""));
    assert_eq!(reopened.stdout, "2|hi\n");
    sqlite_python(
        r#"import sqlite3, sys
db = sqlite3.connect(':memory:')
db.deserialize(sys.stdin.buffer.read())
assert db.execute('SELECT k,n FROM v').fetchall() == [(2, 'hi')]
assert db.execute("SELECT name,tbl_name FROM sqlite_schema WHERE type='view'").fetchall() == [('v', 'v')]
"#,
        &fs.read_file("/records.db").unwrap(),
    );
}

#[test]
fn sqlite_quoted_view_declarations_survive_rewriting() {
    for declaration in [
        r#"CREATE VIEW "v"("k", "n") AS SELECT k,v FROM t"#,
        "CREATE VIEW [v]([k], [n]) AS SELECT k,v FROM t",
        "CREATE VIEW `v`(`k`, `n`) AS SELECT k,v FROM t",
        r#"CREATE VIEW "v"("key AS name", "n""ame") AS SELECT k,v FROM t"#,
    ] {
        let (mut shell, fs) = Shell::with_memory_fs();
        let result = shell.exec_with_options("sqlite3 /records.db", ExecOptions {
            stdin: Some(format!("CREATE TABLE t(k,v); INSERT INTO t VALUES(2,'hi'); {declaration}; SELECT * FROM v;")),
            ..Default::default()
        }).unwrap();
        assert_eq!(
            (result.exit_code, result.stderr.as_str()),
            (0, ""),
            "{declaration}"
        );
        assert_eq!(result.stdout, "2|hi\n", "{declaration}");
        let schema = shell
            .exec("sqlite3 /records.db \"SELECT sql FROM sqlite_schema WHERE type='view';\"")
            .unwrap();
        assert_eq!((schema.exit_code, schema.stderr.as_str()), (0, ""));
        assert_eq!(schema.stdout, format!("{declaration}\n"));
        sqlite_python(
            r#"import sqlite3, sys
db = sqlite3.connect(':memory:')
db.deserialize(sys.stdin.buffer.read())
assert db.execute('SELECT * FROM v').fetchall() == [(2, 'hi')]
assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
"#,
            &fs.read_file("/records.db").unwrap(),
        );
    }
}

#[test]
fn sqlite_legacy_json_view_queries_remain_readable() {
    let (mut shell, fs) = Shell::with_memory_fs();
    fs.write_file(
        "/legacy.db",
        br#"{"t":{"columns":["k","v"],"rows":[["2","hi"]]},"__views__":{"v":"SELECT k,v FROM t"}}"#,
    )
    .unwrap();
    for _ in 0..2 {
        let result = shell.exec("sqlite3 /legacy.db 'SELECT * FROM v;'").unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
        assert_eq!(result.stdout, "2|hi\n");
    }
}
