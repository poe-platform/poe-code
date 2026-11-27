use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_index_catalog() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(n); CREATE INDEX by_n ON t(n); SELECT name FROM sqlite_master WHERE type='index';\nINPUT",
        ExecOptions {
            cwd: Some("/".into()),
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "by_n\n");
}

#[test]
fn sqlite_index_catalog_survives_reopening_and_drop() {
    let (mut shell, _) = Shell::with_memory_fs();
    for (sql, expected) in [
        (
            "CREATE TABLE a(x); CREATE TABLE t(n,m); CREATE INDEX by_m ON t(m DESC); CREATE UNIQUE INDEX by_n ON t(n);",
            "",
        ),
        (
            "SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='index' ORDER BY name;",
            "by_m|t|CREATE INDEX by_m ON t(m DESC)\nby_n|t|CREATE UNIQUE INDEX by_n ON t(n)\n",
        ),
        (
            "DROP INDEX by_m; SELECT name FROM sqlite_master WHERE type='index';",
            "by_n\n",
        ),
        (
            "SELECT name FROM sqlite_master WHERE type='index';",
            "by_n\n",
        ),
    ] {
        let result = shell
            .exec(&format!("sqlite3 /catalog.db <<'INPUT'\n{sql}\nINPUT"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stderr, "");
        assert_eq!(result.stdout, expected, "{sql}");
    }
}
