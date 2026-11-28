use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_power_preserves_required_decimal_digits() {
    for (input, expected) in [
        ("scale=1; scale(1.234^2); 1.234^2", "3\n1.522\n"),
        ("scale=5; 1.234^2", "1.52275\n"),
        ("scale=9; 1.234^2", "1.522756\n"),
        (
            "scale=0; (-1.234)^3; 1.234^0; 1.234^1",
            "-1.879\n1\n1.234\n",
        ),
        ("scale=1; a=1.234^2; scale(a); a; a+0", "3\n1.522\n1.522\n"),
        ("scale=20; 1.0000000001^2", "1.00000000020000000001\n"),
        ("scale=1; .001^2", "0\n"),
        ("scale=1; (1.234*1)^2", "1.522\n"),
        ("scale=3; 2^-2; 1.25^-2", ".250\n.640\n"),
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
        assert_eq!(result.stderr, "", "{input}");
        assert_eq!(result.stdout, expected, "{input}");
    }
}
