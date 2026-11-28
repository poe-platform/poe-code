use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_cast_blob_preserves_storage_class_and_bytes() {
    for (sql, expected) in [
        (
            "SELECT typeof(CAST('xy' AS BLOB)),hex(CAST('xy' AS BLOB));",
            "blob|7879\n",
        ),
        (
            "SELECT typeof(CAST('' AS BLOB)),hex(CAST('' AS BLOB));",
            "blob|\n",
        ),
        (
            "SELECT typeof(CAST(NULL AS BLOB)),hex(CAST(NULL AS BLOB));",
            "null|\n",
        ),
        (
            "SELECT typeof(CAST(12 AS BLOB)),hex(CAST(12 AS BLOB));",
            "blob|3132\n",
        ),
        (
            "SELECT typeof(CAST(X'00FF' AS BLOB)),hex(CAST(X'00FF' AS BLOB));",
            "blob|00FF\n",
        ),
        (
            "CREATE TABLE t(v); INSERT INTO t VALUES(CAST('xy' AS BLOB)); SELECT typeof(v),hex(v) FROM t;",
            "blob|7879\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: '{}'", sql.replace('\'', "'\"'\"'")),
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
        assert_eq!(result.exit_code, 0, "{sql}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{sql}");
        assert_eq!(result.stderr, "", "{sql}");
    }
}
