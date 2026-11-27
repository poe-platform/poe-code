use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn awk_print_accepts_adjacent_expressions_without_matching_identifiers() {
    for (command, expected) in [
        ("awk 'BEGIN { print-\"6\" }\n'", "-6\n"),
        ("awk 'BEGIN { print-6; print+6; print!0 }'", "-6\n6\n1\n"),
        (
            "awk 'BEGIN { print\"six\"; print\t6; print(6) }'",
            "six\n6\n6\n",
        ),
        ("printf 'six\\n' | awk '{print$1; print}'", "six\nsix\n"),
        (
            "awk 'BEGIN { printer=1; print_value=2; print6=3; print printer,print_value,print6; printf \"%s\\n\", \"ok\" }'",
            "1 2 3\nok\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                command,
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
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{command}");
        assert_eq!(result.stdout, expected, "{command}");
    }
}
