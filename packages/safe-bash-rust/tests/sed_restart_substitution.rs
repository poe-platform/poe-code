use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn sed_restart_preserves_substitution_until_input_or_test_resets_it() {
    for (program, input, expected) in [
        ("1{N;s/b/B/;D;};t hit;b;:hit;p", "a\nb\n", "B\n"),
        ("1{N;s/b/B/;D;};T hit;p;b;:hit", "a\nb\n", "B\n"),
        ("1{N;s/x/X/;D;};t hit;b;:hit;p", "a\nb\n", ""),
        ("1{N;s/b/B/;t reset;:reset;D;};t hit;b;:hit;p", "a\nb\n", ""),
        ("1{s/a/A/;D;};t hit;b;:hit;p", "a\nb\n", ""),
        ("1{N;s/b/B/;D;};N;t hit;b;:hit;p", "a\nb\nc\n", ""),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let result = shell
            .exec_with_options(
                &format!("sed -n '{program}' <<'INPUT'\n{input}INPUT\n"),
                ExecOptions {
                    cwd: Some("/".into()),
                    env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{program}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{program}");
        assert_eq!(result.stderr, "", "{program}");
        assert!(!result.used_typescript_bridge);
    }
}
