use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_import_uses_configured_separator() {
    for (options, setup, input, expected) in [
        (
            "",
            ".separator |\nCREATE TABLE t(a,b);",
            "left|right\n",
            "right\n",
        ),
        ("", "CREATE TABLE t(a,b);", "left|right\n", "right\n"),
        ("", "CREATE TABLE t(b);", "left,right\n", "left,right\n"),
        ("", "CREATE TABLE t(b);", "\"right\"\n", "right\n"),
        ("", ".separator ';'", "a;b\nleft;right\n", "right\n"),
        (
            "-separator ';'",
            "CREATE TABLE t(a,b);",
            "left;right\n",
            "right\n",
        ),
        ("", ".mode tabs", "a\tb\nleft\tright\n", "right\n"),
        (
            "",
            ".mode csv\n.separator |\nCREATE TABLE t(a,b);",
            "left|right\n",
            "right\n",
        ),
        (
            "",
            ".separator |\nCREATE TABLE t(a,b);",
            "left|\"right|quoted\"\n",
            "right|quoted\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup_result = shell
            .exec(&format!("printf %s '{input}' > /data.txt"))
            .unwrap();
        assert_eq!(setup_result.exit_code, 0, "{}", setup_result.stderr);
        let script = format!(
            "sqlite3 {options} :memory: <<'INPUT'\n{setup}\n.import data.txt t\nSELECT b FROM t;\nINPUT"
        );
        let result = shell
            .exec_with_options(
                &script,
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
        assert!(!result.used_typescript_bridge);
        assert_eq!(result.stderr, "", "{script}");
        assert_eq!(result.stdout, expected, "{script}");
    }
}

#[test]
fn sqlite_import_csv_overrides_custom_separator() {
    for (setup, input) in [
        ("CREATE TABLE t(a,b);", "left,right\n"),
        ("", "a,b\nleft,right\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "printf %s '{input}' > /data.csv\nsqlite3 :memory: <<'INPUT'\n.separator |\n{setup}\n.import --csv /data.csv t\nSELECT b FROM t;\nINPUT"
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert!(!result.used_typescript_bridge);
        assert_eq!(result.stderr, "");
        assert_eq!(result.stdout, "right\n");
    }
}
