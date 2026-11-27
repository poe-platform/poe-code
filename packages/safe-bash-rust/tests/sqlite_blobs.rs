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
fn sqlite_blob_literal_preserves_bytes() {
    let result = shell()
        .exec_with_options(
            "sqlite3 :memory: <<'INPUT'\nSELECT length(x'00ff10'),hex(x'00ff10');\nINPUT",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "3|00FF10\n");
}

#[test]
fn sqlite_blob_literals_keep_their_type_and_byte_length() {
    for (sql, expected) in [
        (
            "SELECT length(X''),hex(X''),typeof(X''),quote(X'');",
            "0||blob|X''\n",
        ),
        (
            "SELECT length(X'c3a9'),octet_length(X'c3a9'),hex(X'c3a9'),typeof(X'c3a9'),quote(X'c3a9');",
            "2|2|C3A9|blob|X'C3A9'\n",
        ),
        ("SELECT length('é'),hex('é'),typeof('é');", "1|C3A9|text\n"),
        (
            "SELECT hex('x''00ff10'''),typeof('x''00ff10''');",
            "782730306666313027|text\n",
        ),
    ] {
        let result = shell()
            .exec_with_options(
                "sqlite3 :memory:",
                ExecOptions {
                    stdin: Some(sql.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{sql}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{sql}");
    }
}

#[test]
fn sqlite_blob_storage_preserves_bytes_across_reopens_and_updates() {
    let mut shell = shell();
    for (sql, expected) in [
        (
            "CREATE TABLE t(b BLOB); INSERT INTO t VALUES(x'00ff10'),(X''),(X'c3a9'),('00ff10'); SELECT length(b),hex(b),typeof(b),quote(b) FROM t;",
            "3|00FF10|blob|X'00FF10'\n0||blob|X''\n2|C3A9|blob|X'C3A9'\n6|303066663130|text|'00ff10'\n",
        ),
        (
            "SELECT length(b),hex(b),typeof(b),quote(b) FROM t;",
            "3|00FF10|blob|X'00FF10'\n0||blob|X''\n2|C3A9|blob|X'C3A9'\n6|303066663130|text|'00ff10'\n",
        ),
        (
            "UPDATE t SET b=x'80ff00' WHERE hex(b)='00FF10'; SELECT hex(b) FROM t;",
            "80FF00\n\nC3A9\n303066663130\n",
        ),
        (
            "SELECT length(b),hex(b),typeof(b) FROM t;",
            "3|80FF00|blob\n0||blob\n2|C3A9|blob\n6|303066663130|text\n",
        ),
    ] {
        let result = shell
            .exec_with_options(
                "sqlite3 /blobs.db",
                ExecOptions {
                    stdin: Some(sql.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{sql}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{sql}");
    }
}

#[test]
fn sqlite_blob_output_and_exports_preserve_values() {
    for (sql, expected) in [
        ("SELECT X'4142',X'00ff10',X'';", "AB||\n"),
        (".mode quote\nSELECT X'00ff10',X'';", "X'00FF10',X''\n"),
        (
            ".mode insert t\nSELECT X'00ff10',X'';",
            "INSERT INTO t VALUES(X'00FF10',X'');\n",
        ),
        (
            "CREATE TABLE t(b BLOB); INSERT INTO t VALUES(X'00ff10'),(X'');\n.dump",
            "BEGIN TRANSACTION;\nCREATE TABLE t (b);\nINSERT INTO t VALUES (X'00FF10');\nINSERT INTO t VALUES (X'');\nCOMMIT;\n",
        ),
        (".mode json\nSELECT X'4142' AS b;", "[{\"b\":\"AB\"}]\n"),
    ] {
        let result = shell()
            .exec_with_options(
                "sqlite3 :memory:",
                ExecOptions {
                    stdin: Some(sql.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{sql}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{sql}");
    }
}

#[test]
fn sqlite_trigger_values_retain_blob_type() {
    let result = shell().exec_with_options("sqlite3 :memory:", ExecOptions {
        stdin: Some("CREATE TABLE t(b BLOB); CREATE TABLE audit(b BLOB); CREATE TRIGGER copy_blob AFTER INSERT ON t BEGIN INSERT INTO audit VALUES(NEW.b); END; INSERT INTO t VALUES(X'00ff10'); SELECT length(b),hex(b),typeof(b) FROM audit;".into()),
        ..Default::default()
    }).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "3|00FF10|blob\n");
}

#[test]
fn sqlite_blob_insert_select_preserves_bytes_and_nulls() {
    let result = shell().exec_with_options("sqlite3 :memory:", ExecOptions {
        stdin: Some("CREATE TABLE t(b BLOB); INSERT INTO t SELECT X'00ff10'; INSERT INTO t SELECT NULL; INSERT INTO t SELECT ''; SELECT length(b),hex(b),typeof(b),quote(b) FROM t;".into()),
        ..Default::default()
    }).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(
        result.stdout,
        "3|00FF10|blob|X'00FF10'\n||null|NULL\n0||text|''\n"
    );
}

#[test]
fn sqlite_blob_literals_preserve_bytes() {
    for (sql, expected) in [
        (
            "SELECT x'6869',x'00ff10',octet_length(x'00ff10');",
            "hi||3\n",
        ),
        (
            "SELECT length('abc'),hex('abc'),typeof('abc'),quote('abc');",
            "3|616263|text|'abc'\n",
        ),
        ("SELECT length(x'00ff10'),hex(x'00ff10');", "3|00FF10\n"),
        (
            "SELECT length(X''),hex(X''),typeof(X''),quote(x'00aB');",
            "0||blob|X'00AB'\n",
        ),
        (
            "CREATE TABLE t(b BLOB); INSERT INTO t VALUES(x'00ff10'); SELECT length(b),hex(b),typeof(b) FROM t;",
            "3|00FF10|blob\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: <<'INPUT'\n{sql}\nINPUT"),
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
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{sql}");
        assert_eq!(result.stderr, "");
    }
}

#[test]
fn sqlite_blob_storage_preserves_bytes() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /blob.db \"CREATE TABLE t(b BLOB); INSERT INTO t VALUES(x'00ff10'),(X'');\"\nsqlite3 /blob.db \"SELECT length(b),hex(b),typeof(b) FROM t;\"").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "3|00FF10|blob\n0||blob\n");
    assert_eq!(result.stderr, "");
}
