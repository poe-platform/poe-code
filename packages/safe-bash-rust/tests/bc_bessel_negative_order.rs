use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_bessel_negative_order_has_the_reference_sign_and_magnitude() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "bc -l <<'INPUT'\nscale=12; j(-1,1)\nINPUT",
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    // Allow the existing floating-point math library's last-digit differences.
    let value: f64 = result.stdout.trim().parse().unwrap();
    assert!((value - -0.440050585744).abs() < 1e-11, "{value}");
}

#[test]
fn bc_bessel_negative_order_obeys_odd_and_even_symmetry() {
    for n in 0..=4 {
        for x in [-2, -1, 0, 1, 2] {
            let input = format!("scale=12; j(-{n},{x}); j({n},{x})");
            let (mut shell, _) = Shell::with_memory_fs();
            let result = shell
                .exec_with_options(
                    &format!("bc -l <<'INPUT'\n{input}\nINPUT"),
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
            let values: Vec<f64> = result
                .stdout
                .lines()
                .map(|line| line.parse().unwrap())
                .collect();
            assert_eq!(values.len(), 2, "{input}: {}", result.stdout);
            let sign = if n % 2 == 0 { 1.0 } else { -1.0 };
            assert_eq!(values[0], sign * values[1], "{input}");
            if x == 0 && n != 0 {
                assert_eq!(values[0], 0.0, "{input}");
            }
            assert_eq!(result.stderr, "", "{input}");
        }
    }
}
