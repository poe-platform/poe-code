use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn yq_preserves_block_scalar_paragraphs() {
    for (scalar, expected) in [
        (">\n  one\n  two\n\n  three\n", "one two\\nthree\\n"),
        (">\n  one\n\n\n  two\n", "one\\n\\ntwo\\n"),
        (">\n\n  one\n  two\n\n", "\\none two\\n"),
        (">\n  one\n    two\n  three\n", "one\\n  two\\nthree\\n"),
        ("|\n  one\n  two\n\n  three\n", "one\\ntwo\\n\\nthree\\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!(
                    "printf %s 'description: {scalar}next: yes\n' | yq -I 0 -p=yaml -o=json ."
                ),
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
        assert_eq!(result.exit_code, 0, "{scalar}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{scalar}");
        assert_eq!(
            result.stdout,
            format!("{{\"description\":\"{expected}\",\"next\":\"yes\"}}\n"),
            "{scalar}"
        );
    }
}
