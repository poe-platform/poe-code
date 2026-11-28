use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_primary_key_update_rejects_conflicts() {
    for update in [
        "UPDATE t SET id=1 WHERE id=2",
        "UPDATE t SET id=3 RETURNING id",
        "WITH x AS (SELECT 1) UPDATE t SET id=1 WHERE id=2",
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec_with_options(
            &format!("sqlite3 :memory: 'CREATE TABLE t(id INTEGER PRIMARY KEY);INSERT INTO t VALUES(1),(2); {update}; SELECT id FROM t ORDER BY id;'"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        ).unwrap();
        assert_eq!(result.exit_code, 19, "{update}: {}", result.stderr);
        assert_eq!(result.stdout, "", "{update}");
        assert_eq!(
            result.stderr,
            "Error: stepping, UNIQUE constraint failed: t.id (19)\n"
        );
    }
}

#[test]
fn sqlite_primary_key_update_allows_unchanged_and_unused_keys() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: 'CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES(1),(2); UPDATE t SET id=id; UPDATE t SET id=3 WHERE id=2; SELECT id FROM t ORDER BY id;'").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "1\n3\n");
}

#[test]
fn sqlite_update_preserves_unique_constraint_policies() {
    for (schema, update, code, expected) in [
        (
            "id INTEGER PRIMARY KEY ON CONFLICT IGNORE",
            "id=1",
            0,
            "1\n2\n",
        ),
        ("id INTEGER UNIQUE", "id=NULL", 0, "\n\n"),
        ("id INTEGER UNIQUE", "id=3", 19, ""),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!("sqlite3 :memory: 'CREATE TABLE t({schema}); INSERT INTO t VALUES(1),(2); UPDATE t SET {update}; SELECT id FROM t ORDER BY id;'")).unwrap();
        assert_eq!(result.exit_code, code, "{schema}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{schema}");
    }
}

#[test]
fn sqlite_failed_primary_key_update_preserves_persisted_rows() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /keys.db 'CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES(1),(2);'").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let result = shell
        .exec("sqlite3 /keys.db 'UPDATE t SET id=3 RETURNING id;'")
        .unwrap();
    assert_eq!(result.exit_code, 19);
    assert_eq!(result.stdout, "");
    let result = shell
        .exec("sqlite3 /keys.db 'SELECT id FROM t ORDER BY id;'")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "1\n2\n");
}
