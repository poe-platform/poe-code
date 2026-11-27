use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn jq_from_entries_preserves_aliases_through_shell() {
    for (input, filter, expected) in [
        (
            r#"[{"Key":"id","Value":7},{"name":"role","value":"a"}]"#,
            "from_entries",
            "{\"id\":7,\"role\":\"a\"}\n",
        ),
        (
            r#"[{"Name":"n","Value":false},{"key":"missing"}]"#,
            "from_entries",
            "{\"n\":false,\"missing\":null}\n",
        ),
        (
            r#"[{"Name":"last","name":"third","Key":"second","key":"first","Value":7,"value":null}]"#,
            "from_entries",
            "{\"first\":null}\n",
        ),
        (
            r#"[{"name":"third","Key":"second","key":false,"Value":7,"value":false}]"#,
            "from_entries",
            "{\"second\":false}\n",
        ),
        (
            r#"[{"key":false,"Key":null,"name":false,"Name":"last","Value":8}]"#,
            "from_entries",
            "{\"last\":8}\n",
        ),
        (
            r#"[{"Key":"","Value":{"nested":[1,null,false]}}]"#,
            "from_entries",
            "{\"\":{\"nested\":[1,null,false]}}\n",
        ),
        (
            r#"{"id":7,"role":"a"}"#,
            "with_entries({Key: .key, Value: .value})",
            "{\"id\":7,\"role\":\"a\"}\n",
        ),
        ("[]", "from_entries", "{}\n"),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | jq -c '{filter}'"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(
            (result.exit_code, result.stderr.as_str()),
            (0, ""),
            "{input}"
        );
        assert_eq!(result.stdout, expected, "{input}: {filter}");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn jq_from_entries_rejects_invalid_keys_without_output() {
    for input in [
        r#"[{"Key":42,"Value":7}]"#,
        r#"[{"key":42,"Key":"fallback","value":1}]"#,
        r#"[{"Value":7}]"#,
        r#"[{"Key":false}]"#,
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | jq -c from_entries"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 5, "{input}");
        assert!(result.stderr.contains("object key"), "{}", result.stderr);
        assert_eq!(result.stdout, "", "{input}");
        assert!(!result.used_typescript_bridge);
    }
}
