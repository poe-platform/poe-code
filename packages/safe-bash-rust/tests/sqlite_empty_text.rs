use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_counts_empty_text_independently_of_null() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(k); INSERT INTO t VALUES(NULL),(''); SELECT count(*),count(k),count(distinct k) FROM t;\nINPUT",
        ExecOptions {
            cwd: Some("/".into()),
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "2|1|1\n");
    assert_eq!(result.stderr, "");
}

#[test]
fn sqlite_preserves_empty_text_in_storage_expressions_and_output() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /empty.db \"CREATE TABLE t(k); INSERT INTO t VALUES(NULL),(''),(''),('NULL');\"").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    for (query, expected) in [
        (
            "SELECT count(*),count(k),count(distinct k) FROM t",
            "4|3|2\n",
        ),
        (
            "SELECT count(''),count(NULL),count(distinct '') FROM t",
            "4|0|1\n",
        ),
        (
            "SELECT typeof(k),quote(k),coalesce(k,'fallback') FROM t",
            "null|NULL|fallback\ntext|''|\ntext|''|\ntext|'NULL'|NULL\n",
        ),
        (
            "SELECT count(lower(k)),count(substr(k,1)),count(length(k)) FROM t",
            "3|3|3\n",
        ),
        ("SELECT count(*) FROM t WHERE k IS NULL", "1\n"),
        ("SELECT count(*) FROM t WHERE k IS NOT NULL", "3\n"),
        ("SELECT count(*) FROM t WHERE k=''", "2\n"),
    ] {
        let result = shell
            .exec(&format!("sqlite3 /empty.db \"{query}\""))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{query}");
    }
    let result = shell
        .exec("sqlite3 -json /empty.db 'SELECT k FROM t'")
        .unwrap();
    assert_eq!(
        result.stdout,
        "[{\"k\":null},\n{\"k\":\"\"},\n{\"k\":\"\"},\n{\"k\":\"NULL\"}]\n"
    );
    let result = shell
        .exec("sqlite3 -nullvalue missing /empty.db 'SELECT k FROM t'")
        .unwrap();
    assert_eq!(result.stdout, "missing\n\n\nNULL\n");
    let result = shell.exec("sqlite3 /empty.db \"UPDATE t SET k='' WHERE k IS NULL; SELECT count(k),count(distinct k) FROM t;\"").unwrap();
    assert_eq!(result.stdout, "4|2\n");
}

#[test]
fn sqlite_empty_text_satisfies_not_null_and_participates_in_unique_constraints() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /constraints.db \"CREATE TABLE t(k TEXT NOT NULL UNIQUE); INSERT INTO t VALUES(''); SELECT count(k) FROM t;\"").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "1\n");
    let result = shell
        .exec("sqlite3 /constraints.db \"INSERT INTO t VALUES('');\"")
        .unwrap();
    assert_eq!(result.exit_code, 1);
    assert!(result.stderr.contains("UNIQUE constraint failed"));
    let result = shell
        .exec("sqlite3 /constraints.db 'UPDATE t SET k=NULL'")
        .unwrap();
    assert_eq!(result.exit_code, 1);
    assert!(result.stderr.contains("NOT NULL constraint failed"));
}

#[test]
fn sqlite_preserves_null_and_empty_text_through_insert_select_and_defaults() {
    let (mut shell, _) = Shell::with_memory_fs();
    for (sql, expected) in [
        (
            "CREATE TABLE source(k); INSERT INTO source VALUES(NULL),(''); CREATE TABLE target(k); INSERT INTO target SELECT k FROM source; SELECT count(*),count(k),count(distinct k) FROM target;",
            "2|1|1\n",
        ),
        (
            "CREATE TABLE t(id, empty TEXT DEFAULT '', missing TEXT DEFAULT NULL); INSERT INTO t(id) VALUES(1); SELECT count(empty),count(missing) FROM t;",
            "1|0\n",
        ),
        (
            "CREATE TABLE t(k); INSERT INTO t VALUES(''); ALTER TABLE t ADD COLUMN missing; SELECT count(k),count(missing) FROM t;",
            "1|0\n",
        ),
    ] {
        let result = shell
            .exec(&format!("sqlite3 :memory: <<'SQL'\n{sql}\nSQL"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{sql}");
    }
}

#[test]
fn sqlite_empty_text_foreign_keys_restrict_parent_deletion() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: <<'SQL'\nPRAGMA foreign_keys=ON; CREATE TABLE parent(k TEXT PRIMARY KEY); CREATE TABLE child(k TEXT REFERENCES parent(k)); INSERT INTO parent VALUES(''); INSERT INTO child VALUES(''); DELETE FROM parent;\nSQL").unwrap();
    assert_eq!(result.exit_code, 1);
    assert!(result.stderr.contains("FOREIGN KEY constraint failed"));
}
