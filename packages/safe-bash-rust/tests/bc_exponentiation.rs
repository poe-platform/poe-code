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
