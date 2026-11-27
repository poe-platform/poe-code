use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn sqlite_create_as_select_materializes_query_rows() {
    for (sql, expected) in [
        (
            "CREATE TABLE t AS SELECT 17 AS value; SELECT value FROM t;",
            "17\n",
        ),
        (
            "CREATE TABLE t AS SELECT abs(-17) AS value; SELECT value FROM t;",
            "17\n",
        ),
        (
            "CREATE TABLE source(value); INSERT INTO source VALUES(3),(1),(2); CREATE TABLE t AS SELECT value FROM source WHERE value>1 ORDER BY value DESC; SELECT rowid,value FROM t; INSERT INTO t VALUES(4); SELECT rowid,value FROM t WHERE value=4;",
            "1|3\n2|2\n3|4\n",
        ),
        (
            "CREATE TABLE source(value); CREATE TABLE t AS SELECT value FROM source; INSERT INTO t(value) VALUES(17); SELECT value FROM t;",
            "17\n",
        ),
        (
            "CREATE TABLE t AS SELECT NULL AS value UNION ALL SELECT ''; SELECT count(*) FROM t WHERE value IS NULL; SELECT count(*) FROM t WHERE value='';",
            "1\n1\n",
        ),
        (
            "CREATE TABLE t AS SELECT 17 AS value; CREATE TABLE IF NOT EXISTS T AS SELECT 99 AS value; SELECT value FROM t;",
            "17\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: <<'INPUT'\n{sql}\nINPUT"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""), "{sql}");
        assert_eq!(result.stdout, expected, "{sql}");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn sqlite_create_as_select_persists_rows_and_rejects_existing_table() {
    let (mut shell, _) = Shell::with_memory_fs();
    let setup = shell
        .exec("sqlite3 /query.db 'CREATE TABLE t AS SELECT 17 AS value;'")
        .unwrap();
    assert_eq!((setup.exit_code, setup.stderr.as_str()), (0, ""));
    let result = shell
        .exec("sqlite3 /query.db 'SELECT value FROM t;'")
        .unwrap();
    assert_eq!(result.stdout, "17\n");
    let duplicate = shell
        .exec("sqlite3 /query.db 'CREATE TABLE T AS SELECT 99 AS value;'")
        .unwrap();
    assert_eq!(duplicate.exit_code, 1);
    assert!(duplicate.stderr.contains("already exists"));
    let result = shell
        .exec("sqlite3 /query.db 'SELECT value FROM t;'")
        .unwrap();
    assert_eq!(result.stdout, "17\n");
}
