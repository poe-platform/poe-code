use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_length_counts_significant_coefficient_digits() {
    for (program, expected) in [
        ("length(.00031);length(123.00);length(0.0000)", "2\n5\n4\n"),
        (
            "length(-.00031);length(.0003100);length(.0010+.0002)",
            "2\n4\n2\n",
        ),
        (
            "a=.00031;length(a);length(0);length(.0);length(1000);length(1.000)",
            "2\n1\n1\n4\n4\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{program}\n' | bc"),
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
        assert_eq!(result.exit_code, 0, "{program}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{program}");
        assert_eq!(result.stdout, expected, "{program}");
        assert!(!result.used_typescript_bridge, "{program}");
    }
}
