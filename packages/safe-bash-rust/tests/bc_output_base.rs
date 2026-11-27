use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_output_base_preserves_negative_signs() {
    for (input, expected) in [
        ("obase=16;-254", "-FE\n"),
        ("obase=2;-254", "-11111110\n"),
        ("obase=8;-254", "-376\n"),
        ("obase=10;-254", "-254\n"),
        ("obase=16;-sqrt(256)", "-10\n"),
        ("obase=16;print -254,\",\",-sqrt(256),\"\\n\"", "-FE,-10\n"),
        ("obase=16;254;0;-0;sqrt(256);-sqrt(0)", "FE\n0\n0\n10\n0\n"),
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
