use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn jq_abs_preserves_nonnegative_decimal_literals_through_shell() {
    for (input, filter, expected) in [
        (
            "[1000000000000000002]",
            "map(abs)",
            "[1000000000000000002]\n",
        ),
        (
            "[9007199254740993,18446744073709551617,1.2300,1e-999,1e999,0,-0,-0.000]",
            "map(abs)",
            "[9007199254740993,18446744073709551617,1.2300,1E-999,1E+999,0,-0,-0.000]\n",
        ),
        (
            "[1000000000000000002,-1000000000000000002,-1.2300,-1e-999,-2,2]",
            "map(abs)",
            "[1000000000000000002,1e+18,1.23,0,2,2]\n",
        ),
        (
            "[1000000000000000002,-1000000000000000002]",
            "map(fabs)",
            "[1e+18,1e+18]\n",
        ),
        ("[2,-2,0]", "map(. + 0 | abs)", "[2,2,0]\n"),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | jq -c '{filter}'"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input} | {filter}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input} | {filter}");
        assert_eq!(result.stderr, "", "{input} | {filter}");
        assert!(!result.used_typescript_bridge);
    }
}
