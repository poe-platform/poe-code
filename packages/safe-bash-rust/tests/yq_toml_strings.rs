use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn yq_decodes_toml_basic_strings_through_shell() {
    for (input, expected) in [
        (
            r#"message="line\nnext\u0021""#,
            "{\"message\":\"line\\nnext!\"}\n",
        ),
        (
            r#"message="\b\t\n\f\r\"\\\u00E9\U0001F600""#,
            "{\"message\":\"\\b\\t\\n\\f\\r\\\"\\\\é😀\"}\n",
        ),
        (
            r#"message='line\nnext\u0021'"#,
            "{\"message\":\"line\\\\nnext\\\\u0021\"}\n",
        ),
        (
            r#"message="\\n\\u0021""#,
            "{\"message\":\"\\\\n\\\\u0021\"}\n",
        ),
        (
            r#"values=["a\n", {text="\u0021"}]"#,
            "{\"values\":[\"a\\n\",{\"text\":\"!\"}]}\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let quoted = input.replace('\'', "'\\''");
        let result = shell
            .exec_with_options(
                &format!("printf %s '{quoted}\n' | yq -I 0 -p=toml -o=json ."),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn yq_rejects_invalid_toml_basic_string_escapes() {
    for value in [r#""\q""#, r#""\uD800""#, r#""\U00110000""#, r#""\u123""#] {
        let mut shell = Shell::new(Arc::new(MemoryVfs::new()), ShellOptions::default());
        let result = shell
            .exec_with_options(
                &format!("printf %s 'message={value}' | yq -I 0 -p=toml -o=json ."),
                ExecOptions::default(),
            )
            .unwrap();
        assert_ne!(result.exit_code, 0, "{value}");
        assert_eq!(result.stdout, "");
        assert!(
            result.stderr.contains("invalid TOML string escape"),
            "{}",
            result.stderr
        );
    }
}
