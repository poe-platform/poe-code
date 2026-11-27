use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn jq_rejects_paths_through_computed_arrays() {
    for filter in [
        "path(.a | map(select(.b == 0)))",
        "path(.a | map(.))",
        "path(.a | [.[]])",
        "del(.a | map(select(.b == 0)))",
        "(.a | map(select(.b == 0))) = []",
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
                &format!(r#"printf %s '{{"a":[{{"b":0}}]}}' | jq -c '{filter}'"#),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 5, "{filter}: {result:?}");
        assert!(result.stdout.is_empty(), "{filter}: {result:?}");
        assert!(
            result
                .stderr
                .contains(r#"Invalid path expression with result [{"b":0}]"#),
            "{filter}: {result:?}"
        );
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn jq_preserves_paths_through_original_array_elements() {
    for (filter, expected) in [
        ("path(.a[] | select(.b == 0) | .b)", "[\"a\",0,\"b\"]\n"),
        ("path(.a | .[0].b)", "[\"a\",0,\"b\"]\n"),
        ("path(.missing[0].b)", "[\"missing\",0,\"b\"]\n"),
        ("path(.a | empty)", ""),
        ("del(.a[] | select(.b == 0))", "{\"a\":[]}\n"),
        ("(.a[] | select(.b == 0) | .b) = 1", "{\"a\":[{\"b\":1}]}\n"),
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
                &format!(r#"printf %s '{{"a":[{{"b":0}}]}}' | jq -c '{filter}'"#),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(
            (result.exit_code, result.stderr.as_str()),
            (0, ""),
            "{filter}"
        );
        assert_eq!(result.stdout, expected, "{filter}");
        assert!(!result.used_typescript_bridge);
    }
}
