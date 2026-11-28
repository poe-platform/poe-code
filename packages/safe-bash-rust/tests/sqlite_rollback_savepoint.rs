use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_missing_rollback_savepoint_stops_before_commit() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "sqlite3 ledger.db 'CREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE,v INT CHECK(v>=0)); INSERT INTO t VALUES(1,1,10),(2,2,20),(3,3,30);'\nsqlite3 ledger.db 'BEGIN; DELETE FROM t WHERE id=1; ROLLBACK TO nonexistent; COMMIT;'\nsqlite3 ledger.db 'SELECT id,k,v FROM t ORDER BY id;'",
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0);
    assert!(!result.used_typescript_bridge);
    assert_eq!(result.stdout, "1|1|10\n2|2|20\n3|3|30\n");
    assert_eq!(
        result.stderr,
        "Error: stepping, no such savepoint: nonexistent\n"
    );
}
