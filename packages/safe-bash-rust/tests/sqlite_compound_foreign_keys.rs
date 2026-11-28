use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_validates_complete_foreign_key_tuples() {
    for (values, deferred, valid) in [
        ("(1,3)", false, false),
        ("(1,3)", true, false),
        ("(1,2)", false, true),
        ("(1,2)", true, true),
        ("(NULL,3)", false, true),
        ("(1,NULL)", false, true),
        ("(NULL,NULL)", false, true),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let constraint = if deferred {
            " DEFERRABLE INITIALLY DEFERRED"
        } else {
            ""
        };
        let result = shell.exec_with_options(
            &format!("sqlite3 :memory: 'PRAGMA foreign_keys=ON;CREATE TABLE p(a,b,PRIMARY KEY(a,b));CREATE TABLE c(x,y,FOREIGN KEY(x,y) REFERENCES p(a,b){constraint});INSERT INTO p VALUES(1,2),(4,3);BEGIN;INSERT INTO c VALUES{values};COMMIT;'"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        ).unwrap();
        assert_eq!(
            result.exit_code == 0,
            valid,
            "{values}, deferred={deferred}: {}",
            result.stderr
        );
        assert_eq!(result.stdout, "");
        if valid {
            assert_eq!(result.stderr, "");
        } else {
            assert!(
                result.stderr.contains("FOREIGN KEY constraint failed"),
                "{}",
                result.stderr
            );
        }
    }
}

#[test]
fn sqlite_rejects_reported_compound_key_without_output() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: 'PRAGMA foreign_keys=ON;CREATE TABLE p(a,b,PRIMARY KEY(a,b));CREATE TABLE c(x,y,FOREIGN KEY(x,y) REFERENCES p(a,b));INSERT INTO p VALUES(1,2);INSERT INTO c VALUES(1,3);'",
        ExecOptions {
            cwd: Some("/".into()),
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            ..Default::default()
        },
    ).unwrap();
    assert_ne!(result.exit_code, 0);
    assert_eq!(result.stdout, "");
    assert!(result.stderr.contains("FOREIGN KEY constraint failed"));
}

#[test]
fn sqlite_compound_key_validation_survives_reopening() {
    let (mut shell, _) = Shell::with_memory_fs();
    let setup = shell.exec("sqlite3 /db 'CREATE TABLE p(a,b,PRIMARY KEY(a,b));CREATE TABLE c(x,y,FOREIGN KEY(\"x\",\"y\") REFERENCES p(\"a\",\"b\"));INSERT INTO p VALUES(1,2);'").unwrap();
    assert_eq!(setup.exit_code, 0, "{}", setup.stderr);
    let valid = shell
        .exec("sqlite3 /db 'PRAGMA foreign_keys=ON;INSERT INTO c VALUES(1,2);'")
        .unwrap();
    assert_eq!(valid.exit_code, 0, "{}", valid.stderr);
    let invalid = shell
        .exec("sqlite3 /db 'PRAGMA foreign_keys=ON;INSERT INTO c VALUES(1,3);'")
        .unwrap();
    assert_ne!(invalid.exit_code, 0);
    assert_eq!(invalid.stdout, "");
    let rows = shell.exec("sqlite3 /db 'SELECT * FROM c;'").unwrap();
    assert_eq!(rows.stdout, "1|2\n");
}
