use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn declared_ignore_retains_first_row_through_shell() {
    for schema in [
        "k INT UNIQUE ON CONFLICT IGNORE",
        "k INT, UNIQUE(k) ON CONFLICT IGNORE",
        "k INT, CONSTRAINT key UNIQUE(k) ON CONFLICT IGNORE",
        "k INT PRIMARY KEY ON CONFLICT IGNORE",
    ] {
        for persisted in [false, true] {
            for (verb, code, output) in [
                ("INSERT", 0, "1\n"),
                ("INSERT OR ABORT", 1, ""),
                ("INSERT OR REPLACE", 0, "1\n"),
            ] {
                let mut shell = Shell::new(
                    Arc::new(MemoryVfs::new()),
                    ShellOptions {
                        cwd: Some("/".into()),
                        mode: BackendMode::NativeOnly,
                        env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                    },
                );
                let script = if persisted {
                    format!(
                        "sqlite3 /test.db 'CREATE TABLE t({schema});'\nsqlite3 /test.db '{verb} INTO t VALUES(3),(3);SELECT count(*) FROM t;'"
                    )
                } else {
                    format!(
                        "sqlite3 :memory: 'CREATE TABLE t({schema});{verb} INTO t VALUES(3),(3);SELECT count(*) FROM t;'"
                    )
                };
                let result = shell
                    .exec_with_options(&script, ExecOptions::default())
                    .unwrap();
                assert_eq!(result.exit_code, code, "{script}: {result:?}");
                assert_eq!(result.stdout, output, "{script}");
                if code == 0 {
                    assert_eq!(result.stderr, "", "{script}");
                } else {
                    assert_eq!(result.stderr, "Error: UNIQUE constraint failed: t.k\n");
                }
            }
        }
    }
}

#[test]
fn ignore_policy_applies_only_to_its_constraint_and_keeps_first_payload() {
    for (schema, values, code, output) in [
        (
            "k INT UNIQUE ON CONFLICT IGNORE, v TEXT",
            "(3,'first'),(3,'second'),(4,'third')",
            0,
            "3|first\n4|third\n",
        ),
        (
            "k INT, v TEXT, UNIQUE(k,v) ON CONFLICT IGNORE",
            "(3,'first'),(3,'first'),(3,'second')",
            0,
            "3|first\n3|second\n",
        ),
        (
            "k INT UNIQUE ON CONFLICT IGNORE, v TEXT UNIQUE",
            "(3,'first'),(4,'first')",
            1,
            "",
        ),
        (
            "k INT UNIQUE, v TEXT DEFAULT 'ON CONFLICT IGNORE'",
            "(3,'first'),(3,'second')",
            1,
            "",
        ),
        (
            "k INT UNIQUE ON  CONFLICT  IGNORE, v TEXT",
            "(3,'first'),(3,'second')",
            0,
            "3|first\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let sql = format!(
            "CREATE TABLE t({schema});INSERT INTO t VALUES{values};SELECT * FROM t ORDER BY k,v;"
        );
        let result = shell
            .exec_with_options(
                "sqlite3 :memory:",
                ExecOptions {
                    stdin: Some(sql.clone()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, code, "{sql}: {result:?}");
        assert_eq!(result.stdout, output, "{sql}");
        if code == 0 {
            assert_eq!(result.stderr, "", "{sql}");
        } else {
            assert!(
                result.stderr.contains("UNIQUE constraint failed"),
                "{result:?}"
            );
        }
    }
}
