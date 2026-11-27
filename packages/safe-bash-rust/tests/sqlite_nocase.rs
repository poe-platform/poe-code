use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn sqlite_nocase_column_comparisons_through_shell() {
    for (sql, expected) in [
        (
            "CREATE TABLE t(k TEXT COLLATE NOCASE); INSERT INTO t VALUES('Ada'); SELECT count(*) FROM t WHERE k='ADA';",
            "1\n",
        ),
        (
            "CREATE TABLE t(k TEXT COLLATE NOCASE); INSERT INTO t VALUES('Ada'),('Äda'); SELECT k FROM t WHERE 'ADA'=k; SELECT k FROM t WHERE k='äda'; SELECT k FROM t WHERE k>='ada' AND k<='ADA';",
            "Ada\nAda\n",
        ),
        (
            "CREATE TABLE t(k TEXT); INSERT INTO t VALUES('Ada'); SELECT count(*) FROM t WHERE k='ADA';",
            "0\n",
        ),
        (
            "CREATE TABLE t(k TEXT COLLATE NOCASE, b TEXT); INSERT INTO t VALUES('Ada','ADA'); SELECT count(*) FROM t WHERE k=b; SELECT count(*) FROM t WHERE b=k;",
            "1\n0\n",
        ),
        (
            "CREATE TABLE t(k TEXT COLLATE NOCASE); INSERT INTO t VALUES('Ada'); UPDATE t SET k='Bob' WHERE k='ADA'; DELETE FROM t WHERE k='BOB'; SELECT count(*) FROM t;",
            "0\n",
        ),
        (
            "CREATE TABLE t(k TEXT); ALTER TABLE t ADD COLUMN n TEXT COLLATE NOCASE; INSERT INTO t VALUES('x','Ada'); SELECT k FROM t WHERE n='ADA';",
            "x\n",
        ),
        (
            "CREATE TABLE t(k TEXT COLLATE nocase); INSERT INTO t VALUES('Ada'),('Bob'); SELECT k FROM t WHERE k BETWEEN 'ADA' AND 'ada'; SELECT k FROM t WHERE k!='ADA';",
            "Ada\nBob\n",
        ),
        (
            "CREATE TABLE t(k TEXT DEFAULT ' COLLATE NOCASE '); INSERT INTO t VALUES('Ada'); SELECT count(*) FROM t WHERE k='ADA';",
            "0\n",
        ),
    ] {
        for database in [":memory:", "/test.db"] {
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
                    &format!("sqlite3 {database} <<'INPUT'\n{sql}\nINPUT"),
                    ExecOptions::default(),
                )
                .unwrap();
            assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""), "{sql}");
            assert_eq!(result.stdout, expected, "{sql}");
            assert!(!result.used_typescript_bridge);
        }
    }
}

#[test]
fn sqlite_nocase_survives_storage_aliases_joins_and_schema_changes() {
    let (mut shell, _) = Shell::with_memory_fs();
    let setup = shell.exec("sqlite3 /test.db \"CREATE TABLE t(k TEXT COLLATE NOCASE, extra TEXT); INSERT INTO t VALUES('Ada','x'); CREATE TABLE u(k TEXT); INSERT INTO u VALUES('ADA');\"").unwrap();
    assert_eq!(setup.exit_code, 0, "{}", setup.stderr);
    for (sql, expected) in [
        ("SELECT count(*) FROM t AS a WHERE a.k='ADA'", "1\n"),
        ("SELECT count(*) FROM t AS a JOIN u AS b ON a.k=b.k", "1\n"),
        ("SELECT count(*) FROM u AS a JOIN t AS b ON a.k=b.k", "0\n"),
        (
            "ALTER TABLE t DROP COLUMN extra; ALTER TABLE t RENAME COLUMN k TO name; SELECT count(*) FROM t WHERE name='ADA'",
            "1\n",
        ),
        ("SELECT count(*) FROM t WHERE name='ADA'", "1\n"),
    ] {
        let result = shell.exec(&format!("sqlite3 /test.db \"{sql};\"")).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{sql}");
    }
}
