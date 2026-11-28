use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_converts_fractional_literals_using_input_base() {
    for (program, expected) in [
        ("ibase=2; 10.101", "2.625\n"),
        ("ibase=2; .1; -10.101; 10.; 10", ".5\n-2.625\n2\n2\n"),
        ("ibase=8; 12.34", "10.43\n"),
        ("ibase=16; A.F; .FF", "10.9\n.99\n"),
        ("scale=8; ibase=16; .1", "0\n"),
        ("ibase=2; a=10.101; a+.001; scale(a)", "2.750\n3\n"),
        (
            "ibase=2; .0000000000000000000000000000000000000001",
            ".0000000000009094947017729282379150390625\n",
        ),
        ("10.101; .001; 10.", "10.101\n.001\n10\n"),
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
