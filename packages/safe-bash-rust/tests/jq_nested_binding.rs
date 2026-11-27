use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn jq_nested_object_patterns_bind_parent_fields_through_shell() {
    for (input, filter, expected) in [
        (
            r#"{"row":[1,2]}"#,
            ". as {$row:[$first]} | [$row,$first]",
            "[[1,2],1]\n",
        ),
        (
            r#"{"row":{"value":3}}"#,
            ". as {$row:{$value}} | [$row,$value]",
            "[{\"value\":3},3]\n",
        ),
        (r#"{"row":[1,2]}"#, ". as {$row:[$row]} | $row", "[1,2]\n"),
        (
            r#"{"row":[1,2]}"#,
            ". as {$row:[$first]} | [.,$row,$first]",
            "[{\"row\":[1,2]},[1,2],1]\n",
        ),
        (
            r#"{"row":{"value":3}}"#,
            ". as {$row:[$first]} ?// {$row:{$value}} | [$row,$first,$value]",
            "[{\"value\":3},null,3]\n",
        ),
        (
            r#"{"row":[1,2]}"#,
            "99 as $row | . as {row:[$first]} | [$row,$first]",
            "[99,1]\n",
        ),
        (
            r#"{"row":null}"#,
            ". as {$row:$value} | [$row,$value]",
            "[null,null]\n",
        ),
        ("{}", ". as {$row:$value} | [$row,$value]", "[null,null]\n"),
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
            "{filter}"
        );
        assert_eq!(result.stdout, expected, "{filter}");
        assert!(!result.used_typescript_bridge);
    }
}
