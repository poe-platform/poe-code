use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_exponentiation_is_right_associative() {
    for (input, expected) in [
        ("2*3^2;2^3^2", "18\n512\n"),
        ("(2^3)^2;2^(3^2)", "64\n512\n"),
        ("2^2^3^1", "256\n"),
        ("(1+1)^3^2;2^(1+2)^2", "512\n512\n"),
        ("2^3^2*2;1+2^3^2", "1024\n513\n"),
        ("8/2/2;8-2-2", "2\n4\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("bc <<'INPUT'\n{input}\nINPUT\n"),
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

#[test]
fn bc_negative_integer_powers_use_division_scale() {
    for (input, expected) in [
        ("scale=5; 2^(-3); 3^(-2)", ".12500\n.11111\n"),
        ("scale=5; x=2; x^=-3; x; scale(x); x*8", ".12500\n5\n1.00000\n"),
        (
            "scale=5; 2.0^(-3); 3^(-2.0); .2^(-3)",
            ".12500\n.11111\n125.00000\n",
        ),
        (
            "scale=5; (-2)^(-3); (-3)^(-2); 1^(-3); (-1)^(-2)",
            "-.12500\n.11111\n1.00000\n1.00000\n",
        ),
        ("scale=0; 2^(-3); (-2)^(-3); 2^0; 2^3", "0\n0\n1\n8\n"),
        (
            "scale=25; 3^(-2); 7^(-3)",
            ".1111111111111111111111111\n.0029154518950437317784256\n",
        ),
        (
            "scale=5; x=2^(-3); x; scale(x); x*8",
            ".12500\n5\n1.00000\n",
        ),
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

#[test]
fn bc_negative_integer_powers_reject_zero_base() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options("printf %s 'scale=5; 0^(-3)\n' | bc", ExecOptions::default())
        .unwrap();
    assert_ne!(result.exit_code, 0);
    assert_eq!(result.stdout, "");
    assert!(
        result.stderr.contains("Divide by zero"),
        "{}",
        result.stderr
    );
}

#[test]
fn bc_exponentiation_is_right_associative_and_preserves_precedence() {
    for (input, expected) in [
        ("2*3^2;2^3^2", "18\n512\n"),
        ("(2^3)^2;2^(3^2);2^3^2^1", "64\n512\n512\n"),
        ("2^3^2*3;1024/2^3^2;2^3^2+1", "1536\n2\n513\n"),
        ("20-5-3;24/4/2", "12\n3\n"),
        ("2^(1+2)^2;(1+1)^3^2", "512\n512\n"),
        ("a[8]=2;a[2^3]^3^2", "512\n"),
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

