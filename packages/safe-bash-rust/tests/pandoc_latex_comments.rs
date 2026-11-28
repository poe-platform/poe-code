use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn latex_omits_comments_and_preserves_escaped_percent() {
    for (input, expected) in [
        (
            "The visible text% editor note\n continues.\n",
            "The visible text continues.\n",
        ),
        ("joined% editor note\nwords\n", "joinedwords\n"),
        ("first\n% editor note\nsecond\n", "first second\n"),
        (
            "100\\% visible% editor note\n remains\n",
            "100% visible remains\n",
        ),
        ("visible% trailing comment", "visible\n"),
        ("% comment only\n", "\n"),
        ("\\textbf{vis% editor note\nible}\n", "visible\n"),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            },
        );
        let script = format!("printf %s '{input}' | pandoc -f latex -t plain --wrap=none");
        let result = shell
            .exec_with_options(&script, ExecOptions::default())
            .unwrap();
        assert_eq!(result.exit_code, 0, "{script}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{script}");
        assert_eq!(result.stdout, expected, "{script}");
    }
}
