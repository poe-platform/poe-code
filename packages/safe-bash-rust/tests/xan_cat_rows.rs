use safe_bash_rust::{ExecOptions, Shell};

#[test]
fn xan_cat_rows_checks_headers_before_appending() {
    for (second, expected_status, expected_stdout, expected_stderr) in [
        (
            "v,k\n3,z\n",
            1,
            "k,v\nx,1\ny,2\n",
            "xan cat: found inconsistent headers as soon as \"b.csv\"!\nExpected: ByteRecord([\"k\", \"v\"])\nGot: ByteRecord([\"v\", \"k\"])\n",
        ),
        ("k,v\nz,3\n", 0, "k,v\nx,1\ny,2\nz,3\nw,4\n", ""),
        (
            "k\nz\n",
            1,
            "k,v\nx,1\ny,2\n",
            "xan cat: found inconsistent headers as soon as \"b.csv\"!\nExpected: ByteRecord([\"k\", \"v\"])\nGot: ByteRecord([\"k\"])\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec(&format!(
            "printf %s 'k,v\nx,1\ny,2\n' > /a.csv; printf %s '{second}' > /b.csv; printf %s 'k,v\nw,4\n' > /c.csv"
        )).unwrap();
        assert_eq!(setup.exit_code, 0, "{}", setup.stderr);
        let result = shell
            .exec_with_options(
                "xan cat rows a.csv b.csv c.csv",
                ExecOptions {
                    cwd: Some("/".into()),
                    env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, expected_status, "{second}");
        assert_eq!(result.stdout, expected_stdout, "{second}");
        assert_eq!(result.stderr, expected_stderr, "{second}");
        assert!(!result.used_typescript_bridge);
    }
}
