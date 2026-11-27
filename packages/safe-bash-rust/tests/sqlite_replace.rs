use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn replace_unique_business_key_through_shell() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
        },
    );
    let result = shell
        .exec_with_options(
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(id INTEGER PRIMARY KEY,k TEXT UNIQUE); INSERT INTO t VALUES(1,'a'); REPLACE INTO t VALUES(2,'a'); SELECT id FROM t ORDER BY id;\nINPUT",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "2\n");
}

#[test]
fn replace_resolves_unique_constraints_and_preserves_other_rows() {
    for verb in ["REPLACE", "INSERT OR REPLACE"] {
        for (schema, values, replacement, expected) in [
            (
                "id INTEGER PRIMARY KEY, k TEXT UNIQUE",
                "(1,'a'),(3,'b')",
                "(2,'a')",
                "2|a\n3|b\n",
            ),
            (
                "id INTEGER PRIMARY KEY, k TEXT, UNIQUE(k)",
                "(1,'a'),(3,'b')",
                "(2,'a')",
                "2|a\n3|b\n",
            ),
            (
                "id INTEGER PRIMARY KEY, k TEXT, v TEXT, CONSTRAINT business_key UNIQUE(k,v)",
                "(1,'a','x'),(3,'a','y')",
                "(2,'a','x')",
                "2|a|x\n3|a|y\n",
            ),
            (
                "id INTEGER PRIMARY KEY, k TEXT UNIQUE, v TEXT UNIQUE",
                "(1,'a','x'),(2,'b','y'),(4,'c','z')",
                "(3,'a','y')",
                "3|a|y\n4|c|z\n",
            ),
            (
                "id INTEGER PRIMARY KEY, k TEXT UNIQUE",
                "(1,'a'),(2,'b'),(4,'c')",
                "(2,'a')",
                "2|a\n4|c\n",
            ),
            (
                "id INTEGER PRIMARY KEY, k TEXT UNIQUE",
                "(1,NULL),(3,'b')",
                "(2,NULL)",
                "1|\n2|\n3|b\n",
            ),
            (
                "id INTEGER, k TEXT UNIQUE",
                "(1,'a')",
                "(1,'b')",
                "1|a\n1|b\n",
            ),
            (
                "id INTEGER PRIMARY KEY, k TEXT DEFAULT 'not UNIQUE here'",
                "(1,'a')",
                "(2,'a')",
                "1|a\n2|a\n",
            ),
            (
                "id INTEGER PRIMARY KEY, k TEXT, CONSTRAINT valid CHECK(k <> 'UNIQUE')",
                "(1,'a')",
                "(2,'a')",
                "1|a\n2|a\n",
            ),
        ] {
            for persisted in [false, true] {
                let mut shell = Shell::new(
                    Arc::new(MemoryVfs::new()),
                    ShellOptions {
                        mode: BackendMode::NativeOnly,
                        cwd: Some("/".into()),
                        ..Default::default()
                    },
                );
                let setup = format!("CREATE TABLE t({schema}); INSERT INTO t VALUES{values};");
                let change =
                    format!("{verb} INTO t VALUES{replacement}; SELECT * FROM t ORDER BY id;");
                let script = if persisted {
                    format!(
                        "sqlite3 /test.db <<'SQL'\n{setup}\nSQL\nsqlite3 /test.db <<'SQL'\n{change}\nSQL"
                    )
                } else {
                    format!("sqlite3 :memory: <<'SQL'\n{setup}{change}\nSQL")
                };
                let result = shell
                    .exec_with_options(&script, ExecOptions::default())
                    .unwrap();
                assert_eq!(result.exit_code, 0, "{script}: {}", result.stderr);
                assert_eq!(result.stderr, "", "{script}");
                assert_eq!(result.stdout, expected, "{script}");
            }
        }
    }
}

#[test]
fn replace_unique_index_runs_insert_triggers_and_returning() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell.exec_with_options("sqlite3 :memory:", ExecOptions {
        stdin: Some("CREATE TABLE t(id INTEGER PRIMARY KEY,k TEXT); CREATE UNIQUE INDEX business_key ON t(k); CREATE TABLE audit(id INTEGER); CREATE TRIGGER inserted AFTER INSERT ON t BEGIN INSERT INTO audit VALUES(new.id); END; INSERT INTO t VALUES(1,'a'); REPLACE INTO t VALUES(2,'a') RETURNING id; SELECT id FROM t; SELECT id FROM audit ORDER BY id;".into()),
        ..Default::default()
    }).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "2\n2\n1\n2\n");
}

#[test]
fn replace_in_trigger_and_common_table_expression() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell.exec_with_options("sqlite3 :memory:", ExecOptions {
        stdin: Some("CREATE TABLE t(id INTEGER PRIMARY KEY,k TEXT UNIQUE); CREATE TABLE incoming(id INTEGER,k TEXT); CREATE TRIGGER received AFTER INSERT ON incoming BEGIN REPLACE INTO t VALUES(new.id,new.k); END; INSERT INTO t VALUES(1,'a'); INSERT INTO incoming VALUES(2,'a'); SELECT id FROM t; WITH next(id,k) AS (SELECT 3,'a') REPLACE INTO t SELECT id,k FROM next; SELECT id FROM t;".into()),
        ..Default::default()
    }).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "2\n3\n");
}

#[test]
fn unique_conflicts_still_reject_plain_insert_and_allow_ignore() {
    for (verb, exit_code, expected) in [("INSERT", 1, ""), ("INSERT OR IGNORE", 0, "1\n")] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let result = shell.exec_with_options("sqlite3 :memory:", ExecOptions {
            stdin: Some(format!("CREATE TABLE t(id INTEGER PRIMARY KEY,k TEXT UNIQUE); INSERT INTO t VALUES(1,'a'); {verb} INTO t VALUES(2,'a'); SELECT id FROM t;")),
            ..Default::default()
        }).unwrap();
        assert_eq!(result.exit_code, exit_code, "{result:?}");
        assert_eq!(result.stdout, expected, "{verb}");
        if exit_code == 1 {
            assert!(
                result.stderr.contains("UNIQUE constraint failed: t.k"),
                "{result:?}"
            );
        } else {
            assert_eq!(result.stderr, "");
        }
    }
}

#[test]
fn rejected_replacement_preserves_the_existing_row() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            cwd: Some("/".into()),
            ..Default::default()
        },
    );
    let setup = shell.exec("sqlite3 /test.db \"CREATE TABLE t(id INTEGER PRIMARY KEY,k TEXT UNIQUE,v TEXT NOT NULL); INSERT INTO t VALUES(1,'a','old');\"").unwrap();
    assert_eq!(setup.exit_code, 0, "{setup:?}");
    let failed = shell
        .exec("sqlite3 /test.db \"REPLACE INTO t VALUES(2,'a',NULL);\"")
        .unwrap();
    assert_eq!(failed.exit_code, 1, "{failed:?}");
    assert!(
        failed.stderr.contains("NOT NULL constraint failed"),
        "{failed:?}"
    );
    let result = shell.exec("sqlite3 /test.db 'SELECT * FROM t;'").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "1|a|old\n");
}
