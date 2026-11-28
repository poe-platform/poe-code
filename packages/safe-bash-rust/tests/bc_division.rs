use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_division_preserves_exact_digits_and_truncates_to_scale() {
    for (input, expected) in [
        (
            "scale=3;90071992547409931231/7",
            "12867427506772847318.714\n",
        ),
        (
            "scale=3;-90071992547409931231/7",
            "-12867427506772847318.714\n",
        ),
        (
            "scale=3;90071992547409931231/-7",
            "-12867427506772847318.714\n",
        ),
        (
            "scale=3;-90071992547409931231/-7",
            "12867427506772847318.714\n",
        ),
        (
            "scale=3;9007199254740993123.1/.7",
            "12867427506772847318.714\n",
        ),
        ("scale=2;1.23456/2", ".61\n"),
        ("scale=0;90071992547409931231/7", "12867427506772847318\n"),
        ("scale=0;12.3456/.2", "61\n"),
        ("scale=3;0/7", "0\n"),
        ("scale=3;-.0001/2", "0\n"),
        ("scale=20;1/7", ".14285714285714285714\n"),
        (
            "scale=3;x=90071992547409931231/7;x-12867427506772847318;scale(x)",
            ".714\n3\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}\n' | bc"),
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
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "", "{input}");
    }
}
