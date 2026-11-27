use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite3_text_affinity_keeps_distinct_keys() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(k TEXT); INSERT INTO t VALUES('01'),('1'); SELECT count(*) FROM t WHERE k=1;\nINPUT",
        ExecOptions {
            cwd: Some("/".into()),
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "1\n");
}

#[test]
fn sqlite3_comparisons_follow_column_affinity() {
    for (declaration, predicate, expected) in [
        ("TEXT", "k = 1", "1\n"),
        ("TEXT", "1 = k", "1\n"),
        ("VARCHAR(10)", "k = '1'", "1\n"),
        ("CLOB", "k != 1", "1\n"),
        ("TEXT", "k < 1", "1\n"),
        ("TEXT", "k BETWEEN 1 AND 1", "1\n"),
        ("TEXT", "k NOT BETWEEN 1 AND 1", "1\n"),
        ("INTEGER", "k = '1'", "2\n"),
        ("REAL", "1 = k", "2\n"),
        ("NUMERIC", "k = 1", "2\n"),
        ("FLOATING POINT", "k = 1", "2\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "sqlite3 :memory: <<'SQL'\nCREATE TABLE t(k {declaration}); INSERT INTO t VALUES('01'),('1'); SELECT count(*) FROM t WHERE {predicate};\nSQL"
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{declaration}: {predicate}");
    }
}

#[test]
fn sqlite3_affinity_survives_aliases_joins_and_persistence() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /keys.db <<'SQL'\nCREATE TABLE t(k TEXT); INSERT INTO t VALUES('01'),('1'); CREATE TABLE other(k INTEGER); INSERT INTO other VALUES(1);\nSQL").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    for (query, expected) in [
        ("SELECT count(*) FROM t AS a WHERE a.k=1", "1\n"),
        ("SELECT count(*) FROM t AS a JOIN t AS b ON a.k=b.k", "2\n"),
        (
            "SELECT count(*) FROM t AS a JOIN other AS b ON a.k=b.k",
            "2\n",
        ),
        ("SELECT count(*) FROM other WHERE k='01'", "1\n"),
        (
            "ALTER TABLE t ADD COLUMN extra TEXT; ALTER TABLE t DROP COLUMN extra; ALTER TABLE t RENAME COLUMN k TO key; SELECT count(*) FROM t WHERE key=1",
            "1\n",
        ),
        ("SELECT count(*) FROM t WHERE key=1", "1\n"),
    ] {
        let result = shell
            .exec(&format!("sqlite3 /keys.db <<'SQL'\n{query};\nSQL"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{query}");
    }
}

#[test]
fn sqlite3_mutations_only_match_the_requested_text_key() {
    for mutation in [
        "UPDATE t SET k='changed' WHERE k=1",
        "DELETE FROM t WHERE k=1",
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "sqlite3 :memory: <<'SQL'\nCREATE TABLE t(k TEXT); INSERT INTO t VALUES('01'),('1'); {mutation}; SELECT k FROM t WHERE k='01';\nSQL"
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, "01\n", "{mutation}");
    }
}
