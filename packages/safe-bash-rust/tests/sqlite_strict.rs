use safe_bash_rust::{ExecOptions, Shell};

#[test]
fn sqlite_strict_integer_rejects_text_through_shell() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "sqlite3 :memory: \"CREATE TABLE t(n INTEGER) STRICT; INSERT INTO t VALUES('wrong'); SELECT n FROM t;\"",
            ExecOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 19, "{result:?}");
    assert_eq!(result.stdout, "");
    assert_eq!(
        result.stderr,
        "Error: stepping, cannot store TEXT value in INTEGER column t.n (19)\n"
    );
}

#[test]
fn sqlite_strict_failed_writes_preserve_persisted_rows() {
    for write in [
        "INSERT INTO t VALUES(2,2),(3,'wrong') RETURNING n",
        "INSERT INTO t SELECT 2,'wrong'",
        "INSERT OR IGNORE INTO t VALUES(2,'wrong')",
        "INSERT OR REPLACE INTO t VALUES(1,'wrong')",
        "UPDATE t SET n='wrong' RETURNING n",
        "INSERT INTO t VALUES(1,2) ON CONFLICT(id) DO UPDATE SET n='wrong'",
        "CREATE TRIGGER bad AFTER INSERT ON source BEGIN INSERT INTO t VALUES(2,'wrong'); END; INSERT INTO source VALUES(1)",
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec("sqlite3 /db 'CREATE TABLE t(id INTEGER PRIMARY KEY,n INTEGER) STRICT; INSERT INTO t VALUES(1,1); CREATE TABLE source(n);'").unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell.exec(&format!("sqlite3 /db \"{write}\"")).unwrap();
        assert_eq!(result.exit_code, 19, "{write}: {result:?}");
        assert_eq!(result.stdout, "", "{write}");
        assert_eq!(
            result.stderr, "Error: stepping, cannot store TEXT value in INTEGER column t.n (19)\n",
            "{write}"
        );
        let stored = shell
            .exec("sqlite3 /db 'SELECT id,n FROM t; SELECT count(*) FROM source;'")
            .unwrap();
        assert_eq!(stored.exit_code, 0, "{stored:?}");
        assert_eq!(stored.stdout, "1|1\n0\n", "{write}");
    }
}

#[test]
fn sqlite_strict_integer_accepts_lossless_conversions_and_null() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: \"CREATE TABLE t(n INTEGER) STRICT; INSERT INTO t VALUES('42'),(' 003 '),(4.0),('5e1'),(NULL),(-9223372036854775808),(9223372036854775807); SELECT n,typeof(n) FROM t;\"").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(
        result.stdout,
        "42|integer\n3|integer\n4|integer\n50|integer\n|null\n-9223372036854775808|integer\n9223372036854775807|integer\n"
    );
}

#[test]
fn sqlite_strict_integer_rejects_other_storage_classes() {
    for (value, kind) in [
        ("'wrong'", "TEXT"),
        ("1.5", "REAL"),
        ("9223372036854775808", "REAL"),
        ("X'31'", "BLOB"),
    ] {
        for declared_type in ["INTEGER", "INT"] {
            let (mut shell, _) = Shell::with_memory_fs();
            let result = shell.exec(&format!("sqlite3 :memory: \"CREATE TABLE t(n {declared_type}) STRICT; INSERT INTO t VALUES({value}); SELECT n FROM t;\"")).unwrap();
            assert_eq!(result.exit_code, 19, "{value}: {result:?}");
            assert_eq!(result.stdout, "");
            assert_eq!(
                result.stderr,
                format!(
                    "Error: stepping, cannot store {kind} value in {declared_type} column t.n (19)\n"
                )
            );
        }
    }
}

#[test]
fn sqlite_ordinary_integer_remains_permissive() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: \"CREATE TABLE t(n INTEGER); INSERT INTO t VALUES('wrong'); SELECT n FROM t;\"").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "wrong\n");
}

#[test]
fn sqlite_strict_types_keep_their_storage_classes_after_reopening() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /db \"CREATE TABLE t(n INT,r REAL,s TEXT,b BLOB,a ANY) STRICT; INSERT INTO t VALUES('1','2',3,X'34','0005');\"").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    let stored = shell
        .exec("sqlite3 /db 'SELECT typeof(n),typeof(r),typeof(s),typeof(b),typeof(a),a FROM t;'")
        .unwrap();
    assert_eq!(stored.exit_code, 0, "{stored:?}");
    assert_eq!(stored.stdout, "integer|real|text|blob|text|0005\n");
    for (column, value, kind, declared_type) in [
        ("r", "'wrong'", "TEXT", "REAL"),
        ("s", "X'31'", "BLOB", "TEXT"),
        ("b", "'1'", "TEXT", "BLOB"),
        ("b", "1", "INTEGER", "BLOB"),
    ] {
        let result = shell
            .exec(&format!("sqlite3 /db \"UPDATE t SET {column}={value}\""))
            .unwrap();
        assert_eq!(result.exit_code, 19, "{result:?}");
        assert_eq!(
            result.stderr,
            format!(
                "Error: stepping, cannot store {kind} value in {declared_type} column t.{column} (19)\n"
            )
        );
    }
}

#[test]
fn sqlite_strict_foreign_key_actions_roll_back_invalid_values() {
    for (action, change) in [
        ("ON UPDATE CASCADE", "UPDATE parent SET n='wrong'"),
        ("ON DELETE SET DEFAULT", "DELETE FROM parent"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!("sqlite3 /db \"CREATE TABLE parent(n PRIMARY KEY); CREATE TABLE t(n INTEGER DEFAULT 'wrong' REFERENCES parent(n) {action}) STRICT; INSERT INTO parent VALUES(1); INSERT INTO t VALUES(1);\"")).unwrap();
        assert_eq!(result.exit_code, 0, "{result:?}");
        let result = shell
            .exec(&format!(
                "sqlite3 /db \"PRAGMA foreign_keys=ON; {change};\""
            ))
            .unwrap();
        assert_eq!(result.exit_code, 19, "{result:?}");
        let stored = shell
            .exec("sqlite3 /db 'SELECT n FROM parent; SELECT n FROM t;'")
            .unwrap();
        assert_eq!(stored.stdout, "1\n1\n", "{action}");
    }
}

#[test]
fn sqlite_strict_schema_survives_alter_and_invalid_defaults_are_rejected() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /db \"CREATE TABLE t(a ANY) STRICT; ALTER TABLE t ADD COLUMN n INTEGER DEFAULT 'wrong';\"").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    let result = shell
        .exec("sqlite3 /db 'INSERT INTO t DEFAULT VALUES;'")
        .unwrap();
    assert_eq!(result.exit_code, 19, "{result:?}");
    assert_eq!(
        result.stderr,
        "Error: stepping, cannot store TEXT value in INTEGER column t.n (19)\n"
    );
}

#[test]
fn sqlite_create_table_as_does_not_inherit_strict_constraints() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /db \"CREATE TABLE t(n INTEGER) STRICT; INSERT INTO t VALUES(1); CREATE TABLE copied AS SELECT n FROM t; INSERT INTO copied VALUES('wrong'); SELECT n FROM copied;\"").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "1\nwrong\n");
}
