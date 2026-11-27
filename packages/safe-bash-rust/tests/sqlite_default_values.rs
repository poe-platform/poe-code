use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::collections::BTreeMap;
use std::sync::Arc;

#[test]
fn sqlite_default_values_inserts_rows_through_the_shell() {
    for (sql, expected) in [
        (
            "CREATE TABLE requests(status TEXT DEFAULT 'pending'); INSERT INTO requests DEFAULT VALUES; SELECT count(*),max(status) FROM requests;",
            "1|pending\n",
        ),
        (
            "CREATE TABLE requests(status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 3, note TEXT); insert into requests default values; INSERT INTO requests DEFAULT VALUES RETURNING status,attempts; SELECT count(*),max(status),max(attempts),count(note) FROM requests;",
            "pending|3\n2|pending|3|0\n",
        ),
        (
            "CREATE TABLE requests(status TEXT DEFAULT 'pending' UNIQUE); INSERT INTO requests DEFAULT VALUES; INSERT OR IGNORE INTO requests DEFAULT VALUES; SELECT count(*),max(status) FROM requests;",
            "1|pending\n",
        ),
        (
            "CREATE TABLE requests(status TEXT DEFAULT 'pending'); CREATE TABLE audit(status TEXT); CREATE TRIGGER log_request AFTER INSERT ON requests BEGIN INSERT INTO audit VALUES(NEW.status); END; INSERT INTO requests DEFAULT   VALUES; SELECT status FROM audit;",
            "pending\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            },
        );
        let output = shell
            .exec_with_options(
                &format!("sqlite3 :memory: <<'SQL'\n{sql}\nSQL"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(output.exit_code, 0, "{sql}: {}", output.stderr);
        assert_eq!(output.stderr, "", "{sql}");
        assert_eq!(output.stdout, expected, "{sql}");
    }
}

#[test]
fn sqlite_default_values_checks_not_null_constraints() {
    let mut shell = Shell::new(Arc::new(MemoryVfs::new()), ShellOptions::default());
    let output = shell
        .exec_with_options(
            "sqlite3 :memory: 'CREATE TABLE requests(status TEXT NOT NULL); INSERT INTO requests DEFAULT VALUES;'",
            ExecOptions::default(),
        )
        .unwrap();
    assert_ne!(output.exit_code, 0);
    assert!(
        output
            .stderr
            .contains("NOT NULL constraint failed: requests.status")
    );
}
