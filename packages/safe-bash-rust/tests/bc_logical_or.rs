use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_logical_or_evaluates_scalar_operands() {
    for (program, expected) in [
        ("1 || 0; 0 || 1; 0 || 0; 1 || 1", "1\n1\n0\n1\n"),
        ("-2 || 0; 0 || .00001; -0.00 || 0", "1\n1\n0\n"),
        ("0 || 0 || 2; (0 || 1) + 2; 0 || (1 || 0)", "1\n3\n1\n"),
        ("1 < 2 || 3 < 2; 0 || 2 > 1", "1\n1\n"),
        ("a=(0 || 1); a; if (0 || 1) 42", "1\n42\n"),
        ("a=0; 1 || a++; a; 0 || a++; a", "1\n1\n1\n2\n"),
        ("scale=20; 0 || 1/3; 1/3 || 0", "1\n1\n"),
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
    }
}
