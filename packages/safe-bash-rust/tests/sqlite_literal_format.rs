use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::{collections::BTreeMap, sync::Arc};

#[test]
fn sqlite_sql_literal_formatting() {
    for (script, expected) in [
        (
            r#"sqlite3 :memory: 'SELECT printf('"'"'%Q'"'"', '"'"'Jane'"'"''"'"'s'"'"');'"#,
            "'Jane''s'\n",
        ),
        (
            "sqlite3 :memory: <<'SQL'\nSELECT format('%Q', 'Jane''s');\nSQL",
            "'Jane''s'\n",
        ),
        (
            "sqlite3 :memory: <<'SQL'\nSELECT printf('%Q|%Q|%Q|%Q', '', NULL, 'NULL', 42);\nSQL",
            "''|NULL|'NULL'|'42'\n",
        ),
        (
            "sqlite3 :memory: <<'SQL'\nSELECT printf('[%8Q][%-8Q]', 'a''b', 'a''b');\nSQL",
            "[  'a''b']['a''b'  ]\n",
        ),
        (
            "sqlite3 :memory: <<'SQL'\nCREATE TABLE t(v TEXT); INSERT INTO t VALUES('Jane''s'); SELECT printf('%Q', v), format('%Q', v) FROM t; SELECT printf('%Q', max(v)) FROM t;\nSQL",
            "'Jane''s'|'Jane''s'\n'Jane''s'\n",
        ),
        (
            "sqlite3 :memory: <<'SQL'\nSELECT printf('%Q');\nSQL",
            "NULL\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let result = shell
            .exec_with_options(
                script,
                ExecOptions {
                    cwd: Some("/".into()),
                    env: BTreeMap::from([
                        ("LC_ALL".into(), "C".into()),
                        ("TZ".into(), "UTC".into()),
                    ]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{script}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{script}");
        assert_eq!(result.stdout, expected, "{script}");
    }
}
