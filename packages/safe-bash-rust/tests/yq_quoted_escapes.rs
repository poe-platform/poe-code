use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn yq_decodes_double_quoted_yaml_escapes() {
    for (yaml, expected) in [
        (r#"path: "one\ntwo\u0021""#, r#"{"path":"one\ntwo!"}"#),
        (
            r#"value: "\0\a\b\t\n\v\f\r\e\ \"\/\\""#,
            r#"{"value":"\u0000\u0007\b\t\n\u000b\f\r\u001b \"/\\"}"#,
        ),
        (
            r#"value: "\x41\u03BB\U0001F600\N\_\L\P""#,
            "{\"value\":\"Aλ😀\u{85}\u{a0}\u{2028}\u{2029}\"}",
        ),
        (
            r#"value: 'one\ntwo\u0021'"#,
            r#"{"value":"one\\ntwo\\u0021"}"#,
        ),
        (
            r#"value: one\ntwo\u0021"#,
            r#"{"value":"one\\ntwo\\u0021"}"#,
        ),
        (r#"value: "\\n""#, r#"{"value":"\\n"}"#),
        (r#"value: "true""#, r#"{"value":"true"}"#),
        (
            r#"value: ["one\ntwo", "\u0021"]"#,
            r#"{"value":["one\ntwo","!"]}"#,
        ),
        (
            r#"value: {path: "one\ntwo"}"#,
            r#"{"value":{"path":"one\ntwo"}}"#,
        ),
        (
            "value: &text \"one\\ntwo\"\ncopy: *text\n",
            r#"{"value":"one\ntwo","copy":"one\ntwo"}"#,
        ),
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
