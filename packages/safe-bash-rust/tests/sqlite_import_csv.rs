use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_import_preserves_quoted_newlines() {
    for (data, setup, import, expected) in [
        (
            "1,\"first\nsecond\"\n",
            ".mode csv\nCREATE TABLE t(a,b);",
            "--csv",
            "1|66697273740A7365636F6E64\n",
        ),
        (
            "a,b\n1,\"first\nsecond\"\n",
            ".mode csv",
            "",
            "1|66697273740A7365636F6E64\n",
        ),
        (
            "0,\"skip\nthis\"\n1,\"first\nsecond\"",
            "CREATE TABLE t(a,b);",
            "--csv --skip 1",
            "1|66697273740A7365636F6E64\n",
        ),
        (
            "1,\"first\r\n\"\"second\"\"\"\r\n",
            "CREATE TABLE t(a,b);",
            "--csv",
            "1|66697273740D0A227365636F6E6422\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup_result = shell
            .exec(&format!("printf %s '{data}' > /data.csv"))
            .unwrap();
        assert_eq!(setup_result.exit_code, 0, "{}", setup_result.stderr);
        let result = shell.exec_with_options(
            &format!("sqlite3 :memory: <<'INPUT'\n{setup}\n.import {import} data.csv t\n.mode list\nSELECT count(*),hex(b) FROM t;\nINPUT"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        ).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "data: {data:?}");
        assert_eq!(result.stderr, "");
    }
}
