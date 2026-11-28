use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_square_roots_preserve_exact_coefficients_and_scale() {
    for (program, expected) in [
        ("sqrt(9999999999999999)", "99999999\n"),
        ("sqrt(10000000000000000)", "100000000\n"),
        ("sqrt(10000000000000001)", "100000000\n"),
        (
            "a=sqrt(9999999999999999); a; a*a",
            "99999999\n9999999800000001\n",
        ),
        ("scale=2; sqrt(9999999999999999)", "99999999.99\n"),
        ("sqrt(.9999)", ".9999\n"),
        ("sqrt(.0004)", ".0200\n"),
        ("scale=5; sqrt(2.25)", "1.50000\n"),
        (
            "scale=20; a=sqrt(2); a; a+1",
            "1.41421356237309504880\n2.41421356237309504880\n",
        ),
        ("scale=4; sqrt(0)", "0\n"),
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
