use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn join_preserves_null_field_positions() {
    for (input, expected) in [
        (r#"["A",null,"C"]"#, "\"A,,C\"\n"),
        (r#"[null,"B",null]"#, "\",B,\"\n"),
        ("[null,null,null]", "\",,\"\n"),
        ("[null]", "\"\"\n"),
        ("[]", "\"\"\n"),
        ("[1,null,true,false]", "\"1,,true,false\"\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | jq -c 'join(\",\")'"),
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
