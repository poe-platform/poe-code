use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn awk_ranges_check_both_patterns_on_the_starting_record() {
    for (program, input, expected) in [
        (r#"$1=="a",$1=="a" {print}"#, "a\nx\na\n", "a\na\n"),
        ("/a/,/a/ {print}", "a\nx\na\n", "a\na\n"),
        ("NR==2,NR==2 {print}", "x\na\nx\n", "a\n"),
        (
            "/a/,/b/ {print}",
            "x\nab\nx\na\nx\nb\nx\nab\nx\n",
            "ab\na\nx\nb\nab\n",
        ),
        ("/a/,/b/ {print}", "x\na\nx\n", "a\nx\n"),
        ("/a/,/b/ {print}", "x\nb\nx\n", ""),
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
                &format!("awk '{program}' <<'INPUT'\n{input}INPUT\n"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{program}: {result:?}");
        assert_eq!(result.stdout, expected, "{program}");
        assert_eq!(result.stderr, "", "{program}");
        assert!(!result.used_typescript_bridge);
    }
}
