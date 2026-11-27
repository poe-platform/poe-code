use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn yq_preserves_explicit_yaml_strings_without_the_tag() {
    for (yaml, expected) in [
        ("id: !!str 007", r#"{"id":"007"}"#),
        ("!!str 007", r#""007""#),
        (
            "[!!str 007, !!str true, !!str null, !!str 0x20]",
            r#"["007","true","null","0x20"]"#,
        ),
        ("id: !<tag:yaml.org,2002:str> 007", r#"{"id":"007"}"#),
        (r#"id: !!str "one\ntwo""#, r#"{"id":"one\ntwo"}"#),
        ("id: !!str '007'", r#"{"id":"007"}"#),
        (
            "id: &id !!str 007\ncopy: *id",
            r#"{"id":"007","copy":"007"}"#,
        ),
        ("id: '!!str 007'", r#"{"id":"!!str 007"}"#),
        ("id: 007", r#"{"id":7}"#),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!(
                    "printf %s '{}\n' | yq -I 0 -p=yaml -o=json .",
                    yaml.replace('\'', "'\\''")
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
        assert_eq!(result.exit_code, 0, "{yaml}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{yaml}");
        assert!(!result.used_typescript_bridge, "{yaml}");
        assert_eq!(result.stdout, format!("{expected}\n"), "{yaml}");
    }
}
