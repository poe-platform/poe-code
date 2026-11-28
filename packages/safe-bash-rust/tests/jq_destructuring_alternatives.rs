use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn jq_keeps_first_successful_destructuring_alternative() {
    for (input, filter, expected) in [
        (
            "[{\"a\":7},{\"b\":3}]\n",
            "[.[] as {$a} ?// {$b} | [$a,$b]]",
            "[[7,null],[null,null]]\n",
        ),
        (
            r#"[{"a":7},{"b":3},{"a":null,"b":3},{"a":false,"b":3}]"#,
            "[.[] as {a: $a} ?// {b: $b} | [$a,$b]]",
            "[[7,null],[null,null],[null,null],[false,null]]\n",
        ),
        (
            r#"[{"a":7,"b":3}]"#,
            "[.[] as {$a, $missing} ?// {$b} | [$a,$missing,$b]]",
            "[[7,null,null]]\n",
        ),
        (
            r#"[[7],{"b":3}]"#,
            "[.[] as [$a] ?// {$b} | [$a,$b]]",
            "[[7,null],[null,3]]\n",
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
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | jq -c '{filter}'"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
        assert_eq!(result.stdout, expected, "{input}: {filter}");
        assert!(!result.used_typescript_bridge);
    }
}
