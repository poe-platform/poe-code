use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_remainder_uses_the_requested_quotient_scale() {
    for (input, expected) in [
        ("scale=2; 5.10 % 2.3", ".017\n"),
        ("scale=0; 5.10 % 2.3", ".50\n"),
        ("scale=4; 5.10 % 2.3", ".00021\n"),
        ("scale=2; (-5.10) % 2.3", "-.017\n"),
        ("scale=2; 5.10 % (-2.3)", ".017\n"),
        ("scale=2; 5 % 3", ".02\n"),
        ("scale=2; .51 % .23", ".0017\n"),
        ("scale=2; 5.10 % 2.50", "0\n"),
        ("scale=1; 1.234 % .3", ".004\n"),
        ("scale=2; x=5.10; x%=2.3; x; scale(x)", ".017\n3\n"),
        ("scale=0; 999999999999999999999999 % 7", "0\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("bc <<'INPUT'\n{input}\nINPUT"),
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

#[test]
fn bc_remainder_rejects_zero_divisors_without_printing_a_value() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "bc <<'INPUT'\nscale=2; 5.10 % 0\nINPUT",
            ExecOptions::default(),
        )
        .unwrap();
    assert_ne!(result.exit_code, 0);
    assert_eq!(result.stdout, "");
    assert!(
        result.stderr.contains("Divide by zero"),
        "{}",
        result.stderr
    );
}
