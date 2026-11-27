use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn jq_implode_preserves_replacement_characters() {
    for (input, expected) in [
        ("[65,55296,66]", "[65,65533,66]\n"),
        (
            "[55295,55296,56319,56320,57343,57344,1114111,1114112]",
            "[55295,65533,65533,65533,65533,57344,1114111,65533]\n",
        ),
        ("[0,65,233,128512]", "[0,65,233,128512]\n"),
        ("[]", "[]\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | jq -c 'implode | explode'"),
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
