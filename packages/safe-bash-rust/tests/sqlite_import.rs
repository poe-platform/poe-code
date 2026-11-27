use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::collections::BTreeMap;
use std::sync::Arc;

#[test]
fn sqlite_import_preserves_rows_equal_to_column_names() {
    for (setup, import, expected) in [
        ("CREATE TABLE t(a,b);", ".import --csv data.csv t", "2\n"),
        (
            "CREATE TABLE t(a,b);",
            ".import --csv --skip 1 data.csv t",
            "1\n",
        ),
        ("", ".import --csv data.csv t", "1\n"),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                mode: BackendMode::NativeOnly,
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            },
        );
        let input = shell.exec("printf %s 'a,b\na,b\n' > data.csv").unwrap();
        assert_eq!(input.exit_code, 0, "{}", input.stderr);
        let result = shell
            .exec_with_options(
                &format!(
                    "sqlite3 :memory: <<'INPUT'\n{setup}\n{import}\nSELECT COUNT(*) FROM t;\nINPUT\n"
                ),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stderr, "");
        assert_eq!(result.stdout, expected, "{setup} {import}");
        assert!(!result.used_typescript_bridge);
    }
}
