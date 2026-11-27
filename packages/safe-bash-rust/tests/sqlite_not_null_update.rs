use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite3_update_enforces_not_null() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options("sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(k TEXT NOT NULL); INSERT INTO t VALUES('keep'); UPDATE t SET k=NULL; SELECT k FROM t;\nINPUT", ExecOptions { cwd: Some("/".into()), env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]), ..Default::default() }).unwrap();
    assert_eq!(result.exit_code, 1);
    assert_eq!(result.stdout, "");
    assert!(result.stderr.contains("NOT NULL constraint failed: t.k"));

    let result = shell.exec("sqlite3 /required.db \"CREATE TABLE t(k TEXT NOT NULL, replacement TEXT); INSERT INTO t VALUES('first','changed'),('keep',NULL);\"").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    for update in [
        "UPDATE t SET k=replacement RETURNING k",
        "WITH replacement(value) AS (SELECT NULL) UPDATE t SET k=NULL",
        "CREATE TRIGGER bad AFTER UPDATE ON t BEGIN UPDATE t SET k=NULL; END; UPDATE t SET k=replacement WHERE replacement IS NOT NULL",
    ] {
        let result = shell
            .exec(&format!("sqlite3 /required.db '{update}'"))
            .unwrap();
        assert_eq!(result.exit_code, 1, "{update}");
        assert_eq!(result.stdout, "", "{update}");
        assert!(result.stderr.contains("NOT NULL constraint failed: t.k"));
        let result = shell
            .exec("sqlite3 /required.db 'SELECT k FROM t'")
            .unwrap();
        assert_eq!(result.stdout, "first\nkeep\n");
    }
    let result = shell.exec("sqlite3 /required.db \"DROP TRIGGER bad; UPDATE t SET k=NULL WHERE k='absent'; UPDATE t SET k='valid' WHERE k='first'; SELECT k FROM t;\"").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "valid\nkeep\n");
}
