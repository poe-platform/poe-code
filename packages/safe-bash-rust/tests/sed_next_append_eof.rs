use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn sed_next_append_at_eof_preserves_the_pattern_space() {
    for (command, input, expected) in [
        (
            "sed 'N;s/\\n/-/' <<'INPUT'\na\nb\nc\nINPUT\n",
            "",
            "a-b\nc\n",
        ),
        (
            "cat > /input; sed -i 'N;s/\\n/-/' /input; cat /input",
            "a\nb\nc\n",
            "a-b\nc\n",
        ),
        ("sed 'aX\nN'", "a\nb\nc\n", "X\na\nb\nc\nX\n"),
        ("sed -n 'aX\nN'", "a\nb\nc\n", "X\nX\n"),
        ("sed 'N;s/\\n/-/'", "a\nb\nc", "a-b\nc"),
        ("sed 'N;s/\\n/-/'", "a\nb\n", "a-b\n"),
        ("sed 'N;s/\\n/-/'", "", ""),
        ("sed 'N;s/c/changed/'", "c\n", "c\n"),
        ("sed '{N;};s/c/changed/'", "c\n", "c\n"),
        ("sed -n 'N;s/\\n/-/p'", "a\nb\nc\n", "a-b\n"),
        ("sed -n '{N;};p'", "c\n", ""),
        ("sed 'N;N;s/a/changed/'", "a\nb", "a\nb"),
        ("sed 'n;s/./changed/'", "c\n", "c\n"),
        ("sed -z 'N'", "a\0b\0c\0", "a\0b\0c\0"),
        ("sed -z 'N'", "a\0b\0c", "a\0b\0c"),
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
                command,
                ExecOptions {
                    stdin: Some(input.into()),
                    ..ExecOptions::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {result:?}");
        assert_eq!(result.stdout, expected, "{command}, input {input:?}");
        assert_eq!(result.stderr, "", "{command}");
        assert!(!result.used_typescript_bridge);
    }
}
