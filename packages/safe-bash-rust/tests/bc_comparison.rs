use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_compares_exact_values_before_producing_booleans() {
    for (program, expected) in [
        ("9007199254740993>9007199254740992", "1\n"),
        (
            "a=9007199254740993; b=9007199254740992; a==b; a!=b; a<=b; a>=b; a<b; a>b",
            "0\n1\n0\n1\n0\n1\n",
        ),
        ("-9007199254740993 < -9007199254740992", "1\n"),
        ("9007199254740993.00 == 9007199254740993", "1\n"),
        (".00000000000001 == .00000000000002", "0\n"),
        (".00000000000001 < .00000000000002", "1\n"),
        ("1.01 > 1.001; -1.01 < -1.001", "1\n1\n"),
        ("-1 < 0; 0 > -1; -0.00 == 0; 0.00 <= 0", "1\n1\n1\n1\n"),
        ("if (9007199254740993>9007199254740992) 42", "42\n"),
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
