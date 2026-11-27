use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn yq_toml_multiline_strings_through_shell() {
    for (input, expected) in [
        (
            "message=\"\"\"\nfirst\nsecond\"\"\"\n",
            "{\"message\":\"first\\nsecond\"}\n",
        ),
        (
            "message='''\nfirst\nsecond'''\n",
            "{\"message\":\"first\\nsecond\"}\n",
        ),
        (
            "message=\"\"\"a\\nb\\t\\u0041\\U0001F600\"\"\"",
            "{\"message\":\"a\\nb\\tA😀\"}\n",
        ),
        (
            "message='''a\\nb\\t\\u0041'''",
            "{\"message\":\"a\\\\nb\\\\t\\\\u0041\"}\n",
        ),
        (
            "message=\"\"\"\r\nfirst\r\nsecond\"\"\"",
            "{\"message\":\"first\\nsecond\"}\n",
        ),
        (
            "message=\"\"\"  first  \n# body\nnext=2\n[end]\n\"\"\" # end\nnext=3",
            "{\"message\":\"  first  \\n# body\\nnext=2\\n[end]\\n\",\"next\":3}\n",
        ),
        (
            "message=\"\"\"one\\  \n \n  two\"\"\"",
            "{\"message\":\"onetwo\"}\n",
        ),
        (
            "message=\"\"\"a\\\"\"\"b\"\"\"",
            "{\"message\":\"a\\\"\\\"\\\"b\"}\n",
        ),
        ("message=\"\"\"a\"\"\"\"\"", "{\"message\":\"a\\\"\\\"\"}\n"),
        ("message='''a'''''", "{\"message\":\"a''\"}\n"),
        (
            "message=\"\"\"\"\"\"\nnext=2",
            "{\"message\":\"\",\"next\":2}\n",
        ),
        (
            "[section]\nmessage='''\n  literal\\\n  body\n'''\nnext=true",
            "{\"section\":{\"message\":\"  literal\\\\\\n  body\\n\",\"next\":true}}\n",
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
                &format!("printf %s '{quoted}' | yq -I 0 -p=toml -o=json ."),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}
