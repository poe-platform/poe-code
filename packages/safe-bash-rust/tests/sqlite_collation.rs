use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::{collections::BTreeMap, sync::Arc};

#[test]
fn sqlite3_nocase_column_matches_ascii_case() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell
        .exec_with_options(
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(k TEXT COLLATE NOCASE); INSERT INTO t VALUES('Ada'); SELECT count(*) FROM t WHERE k='ADA';\nINPUT",
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "1\n");
    assert_eq!(result.stderr, "");
}

#[test]
fn sqlite3_collation_comparisons_preserve_binary_and_ascii_rules() {
    for (declaration, predicate, expected) in [
        ("TEXT COLLATE NOCASE", "k='ADA'", "1\n"),
        ("TEXT COLLATE nocase", "'ADA'=k", "1\n"),
        ("TEXT COLLATE \"NOCASE\"", "(k)='ADA'", "1\n"),
        ("TEXT COLLATE NOCASE", "k!='ADA'", "0\n"),
        ("TEXT COLLATE NOCASE", "k<'B'", "1\n"),
        ("TEXT COLLATE NOCASE", "k BETWEEN 'ADA' AND 'ADA'", "1\n"),
        (
            "TEXT COLLATE NOCASE",
            "k NOT BETWEEN 'ADA' AND 'ADA'",
            "0\n",
        ),
        ("TEXT", "k='ADA'", "0\n"),
        ("TEXT COLLATE BINARY", "k='ADA'", "0\n"),
        ("TEXT DEFAULT ' COLLATE NOCASE '", "k='ADA'", "0\n"),
        ("TEXT COLLATE NOCASE", "k COLLATE BINARY='ADA'", "0\n"),
        ("TEXT", "k='ADA' COLLATE NOCASE", "1\n"),
        ("TEXT COLLATE NOCASE", "k=b", "1\n"),
        ("TEXT COLLATE NOCASE", "b=k", "0\n"),
        (
            "TEXT COLLATE NOCASE",
            "k COLLATE BINARY=b COLLATE NOCASE",
            "0\n",
        ),
        ("TEXT COLLATE NOCASE", "k='ÄDA'", "0\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "sqlite3 :memory: <<'SQL'\nCREATE TABLE t(k {declaration}, b TEXT); INSERT INTO t VALUES('Ada','ADA'); SELECT count(*) FROM t WHERE {predicate};\nSQL"
        )).unwrap();
        assert_eq!(
            result.exit_code, 0,
            "{declaration}: {predicate}: {}",
            result.stderr
        );
        assert_eq!(result.stdout, expected, "{declaration}: {predicate}");
    }
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: \"CREATE TABLE t(k TEXT COLLATE NOCASE); INSERT INTO t VALUES('ä'); SELECT count(*) FROM t WHERE k='Ä';\"").unwrap();
    assert_eq!(result.stdout, "0\n");
}

#[test]
fn sqlite3_nocase_survives_aliases_joins_schema_changes_and_reopen() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /keys.db \"CREATE TABLE t(k TEXT COLLATE NOCASE); INSERT INTO t VALUES('Ada'); CREATE TABLE other(k TEXT); INSERT INTO other VALUES('ADA');\"").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    for query in [
        "SELECT count(*) FROM t AS a WHERE a.k='ADA'",
        "SELECT count(*) FROM t AS a JOIN other AS b ON a.k=b.k",
        "ALTER TABLE t ADD COLUMN extra TEXT COLLATE NOCASE; UPDATE t SET extra='Ada'; SELECT count(*) FROM t WHERE extra='ADA'",
        "ALTER TABLE t DROP COLUMN extra; ALTER TABLE t RENAME COLUMN k TO key; SELECT count(*) FROM t WHERE key='ADA'",
        "SELECT count(*) FROM t WHERE key='ADA'",
    ] {
        let result = shell
            .exec(&format!("sqlite3 /keys.db <<'SQL'\n{query};\nSQL"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{query}: {}", result.stderr);
        assert_eq!(result.stdout, "1\n", "{query}");
    }
}

#[test]
fn sqlite3_nocase_applies_to_update_and_delete_predicates() {
    for (mutation, expected) in [
        ("UPDATE t SET k='changed' WHERE k='ADA'", "changed\n"),
        ("DELETE FROM t WHERE k='ADA'", ""),
        (
            "UPDATE t SET k='changed' FROM other AS o WHERE t.k=o.k",
            "changed\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "sqlite3 :memory: <<'SQL'\nCREATE TABLE t(k TEXT COLLATE NOCASE); INSERT INTO t VALUES('Ada'); CREATE TABLE other(k TEXT); INSERT INTO other VALUES('ADA'); {mutation}; SELECT k FROM t;\nSQL"
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{mutation}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{mutation}");
    }
}
