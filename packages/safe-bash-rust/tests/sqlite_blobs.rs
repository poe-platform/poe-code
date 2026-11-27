use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

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
