use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn sed_change_waits_for_the_range_end() {
    for (command, input, expected) in [
        (
            "sed '/start/,/end/c changed' <<'INPUT'\na\nstart\nx\nINPUT\n",
            "",
            "a\n",
        ),
        ("sed '/start/,/end/c changed'", "a\nstart\nx", "a\n"),
        ("sed '/start/,/end/c changed'", "a\nstart\n", "a\n"),
        ("sed '2,9c changed'", "a\nstart\nx\n", "a\n"),
        ("sed '/start/,+3c changed'", "a\nstart\nx\n", "a\n"),
        ("sed '0,/end/c changed'", "a\nstart\nx\n", ""),
        (
            "sed '/start/,/end/c changed'",
            "a\nstart\nx\nend\nz\nstart\nx\n",
            "a\nchanged\nz\n",
        ),
        (
            "sed '/start/,/end/c changed'",
            "a\nstart\nend\n",
            "a\nchanged\n",
        ),
        ("sed '2,3c changed'", "a\nstart\nx\n", "a\nchanged\n"),
        ("sed '2,$c changed'", "a\nstart\nx\n", "a\nchanged\n"),
        ("sed '3,$c changed'", "a\nstart\nx\n", "a\nstart\nchanged\n"),
        ("sed '/start/,$c changed'", "a\nstart\n", "a\nchanged\n"),
        (
            "sed '/start/,/end/!c changed'",
            "a\nstart\nx\n",
            "changed\nstart\nx\n",
        ),
        ("sed '/start/c changed'", "a\nstart\n", "a\nchanged\n"),
        ("sed -n '/start/,/end/c changed'", "a\nstart\nx\n", ""),
        (
            "sed -n '/start/,/end/c changed'",
            "a\nstart\nend\n",
            "changed\n",
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
