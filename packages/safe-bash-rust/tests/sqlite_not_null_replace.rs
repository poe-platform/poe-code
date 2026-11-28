use safe_bash_rust::Shell;

#[test]
fn sqlite_not_null_replace_persists_default_value_type_and_schema() {
    let (mut shell, _) = Shell::with_memory_fs();
    let schema = "CREATE TABLE t(k INTEGER PRIMARY KEY, v TEXT NOT NULL ON CONFLICT REPLACE DEFAULT 'unknown')";
    for (sql, expected) in [
        (schema, String::new()),
        ("INSERT INTO t VALUES(1,NULL)", String::new()),
        ("SELECT k,v,typeof(v) FROM t", "1|unknown|text\n".into()),
        (
            "SELECT sql FROM sqlite_master WHERE name='t'",
            format!("{schema}\n"),
        ),
        (
            "INSERT INTO t(k) VALUES(2); UPDATE t SET v=NULL; SELECT k,v,typeof(v) FROM t ORDER BY k",
            "1|unknown|text\n2|unknown|text\n".into(),
        ),
        (
            "SELECT k,v,typeof(v) FROM t ORDER BY k",
            "1|unknown|text\n2|unknown|text\n".into(),
        ),
    ] {
        let result = shell
            .exec(&format!("sqlite3 /ledger.db <<'SQL'\n{sql};\nSQL"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{sql}: {result:?}");
        assert_eq!(result.stdout, expected, "{sql}");
        assert_eq!(result.stderr, "", "{sql}");
    }
}

#[test]
fn sqlite_not_null_replace_applies_column_affinity() {
    for (kind, default, expected) in [
        ("TEXT", "42", "42|text\n"),
        ("INTEGER", "'0042'", "42|integer\n"),
        ("BLOB", "'0042'", "0042|text\n"),
        ("TEXT", "''", "|text\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!("sqlite3 /db \"CREATE TABLE t(v {kind} NOT NULL ON CONFLICT REPLACE DEFAULT {default}); INSERT INTO t VALUES(NULL);\"")).unwrap();
        assert_eq!(result.exit_code, 0, "{result:?}");
        let result = shell
            .exec("sqlite3 /db 'SELECT v,typeof(v) FROM t'")
            .unwrap();
        assert_eq!(result.stdout, expected);
    }
}

#[test]
fn sqlite_not_null_replace_without_non_null_default_aborts_statement() {
    for default in ["", " DEFAULT NULL"] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!("sqlite3 /db \"CREATE TABLE t(v TEXT NOT NULL ON CONFLICT REPLACE{default}); INSERT INTO t VALUES('kept');\"")).unwrap();
        assert_eq!(result.exit_code, 0, "{result:?}");
        for write in [
            "INSERT INTO t VALUES('rolled back'),(NULL)",
            "UPDATE t SET v=NULL",
        ] {
            let result = shell.exec(&format!("sqlite3 /db \"{write}\"")).unwrap();
            assert_ne!(result.exit_code, 0, "{default}: {write}: {result:?}");
            assert!(
                result.stderr.contains("NOT NULL constraint failed: t.v"),
                "{result:?}"
            );
            let stored = shell
                .exec("sqlite3 /db 'SELECT v,typeof(v) FROM t'")
                .unwrap();
            assert_eq!(stored.stdout, "kept|text\n");
        }
    }
}

#[test]
fn sqlite_insert_conflict_mode_overrides_not_null_column_policy() {
    for (policy, insert, expected, fails) in [
        ("ON CONFLICT REPLACE", "INSERT OR IGNORE", "", false),
        ("ON CONFLICT REPLACE", "INSERT OR ABORT", "", true),
        ("", "INSERT", "", true),
        ("", "INSERT OR REPLACE", "unknown|text\n", false),
        ("", "REPLACE", "unknown|text\n", false),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec(&format!(
                "sqlite3 /db \"CREATE TABLE t(v TEXT NOT NULL {policy} DEFAULT 'unknown');\""
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{result:?}");
        let result = shell
            .exec(&format!("sqlite3 /db '{insert} INTO t VALUES(NULL)'"))
            .unwrap();
        assert_eq!(result.exit_code != 0, fails, "{insert}: {result:?}");
        let stored = shell
            .exec("sqlite3 /db 'SELECT v,typeof(v) FROM t'")
            .unwrap();
        assert_eq!(stored.stdout, expected, "{insert}");
    }
}

#[test]
fn sqlite_not_null_replace_does_not_override_upsert_update_abort() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /db \"CREATE TABLE t(k INTEGER PRIMARY KEY, v TEXT NOT NULL ON CONFLICT REPLACE DEFAULT 'unknown'); INSERT INTO t VALUES(1,'kept');\"").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    let result = shell
        .exec("sqlite3 /db \"INSERT INTO t VALUES(1,'new') ON CONFLICT(k) DO UPDATE SET v=NULL;\"")
        .unwrap();
    assert_ne!(result.exit_code, 0, "{result:?}");
    assert!(result.stderr.contains("NOT NULL constraint failed: t.v"));
    let stored = shell
        .exec("sqlite3 /db 'SELECT v,typeof(v) FROM t'")
        .unwrap();
    assert_eq!(stored.stdout, "kept|text\n");
}

#[test]
fn sqlite_not_null_text_inside_defaults_is_not_a_constraint() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /db \"CREATE TABLE t(v TEXT DEFAULT 'NOT NULL ON CONFLICT REPLACE'); INSERT INTO t VALUES(NULL);\"").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    let result = shell.exec("sqlite3 /db 'SELECT typeof(v) FROM t'").unwrap();
    assert_eq!(result.stdout, "null\n");
}

#[test]
fn sqlite_not_null_replace_survives_schema_reconstruction() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /db \"CREATE TABLE t(v TEXT NOT NULL ON CONFLICT REPLACE DEFAULT 'unknown'); ALTER TABLE t RENAME TO renamed;\"").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    let result = shell
        .exec("sqlite3 /db 'INSERT INTO renamed VALUES(NULL); SELECT v,typeof(v) FROM renamed;'")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "unknown|text\n");
    let schema = shell
        .exec("sqlite3 /db \"SELECT sql FROM sqlite_master WHERE name='renamed'\"")
        .unwrap();
    assert!(
        schema.stdout.contains("NOT NULL ON CONFLICT REPLACE"),
        "{schema:?}"
    );
}

#[test]
fn sqlite_update_conflict_mode_overrides_not_null_column_policy() {
    for (policy, update, expected) in [
        ("ON CONFLICT REPLACE", "UPDATE OR IGNORE", "kept|text\n"),
        ("", "UPDATE OR REPLACE", "unknown|text\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec(&format!("sqlite3 /db \"CREATE TABLE t(v TEXT NOT NULL {policy} DEFAULT 'unknown'); INSERT INTO t VALUES('kept');\"")).unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell
            .exec(&format!("sqlite3 /db '{update} t SET v=NULL'"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{result:?}");
        let stored = shell
            .exec("sqlite3 /db 'SELECT v,typeof(v) FROM t'")
            .unwrap();
        assert_eq!(stored.stdout, expected, "{update}");
    }
}
