use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_preserves_decimal_coefficients() {
    for (program, expected) in [
        (
            "scale=30; .12345678901234567890123456789+.00000000000000000000000000001",
            ".12345678901234567890123456790\n",
        ),
        (
            "scale=0; .99999999999999999999999999999+.01",
            "1.00999999999999999999999999999\n",
        ),
        (
            "a=.12345678901234567890123456789; a+=.00000000000000000000000000001; a; a-1; -a+a",
            ".12345678901234567890123456790\n-.87654321098765432109876543210\n0\n",
        ),
        (
            ".00000000000000000000000000001-.00000000000000000000000000002",
            "-.00000000000000000000000000001\n",
        ),
        ("999999999999999.1+.2", "999999999999999.3\n"),
        ("obase=16; 15.25+.75", "10.00\n"),
        (
            "a=.0010+.0002; length(a); scale(a); if(a) 1; a*2",
            "2\n4\n1\n.0024\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("bc <<'INPUT'\n{program}\nINPUT\n"),
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
