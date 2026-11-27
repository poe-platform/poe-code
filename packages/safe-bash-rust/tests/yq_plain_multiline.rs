use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn yq_folds_plain_scalar_continuation_lines() {
    for (yaml, expected) in [
        (
            "summary: first line\n  second line\ncount: 2",
            r#"{"summary":"first line second line","count":2}"#,
        ),
        (
            "outer:\n  summary: first\n    second\n      third\n  count: 2",
            r#"{"outer":{"summary":"first second third","count":2}}"#,
        ),
        ("- first\n  second\n- third", r#"["first second","third"]"#),
        (
            "- summary: first\n    second\n  count: 2",
            r#"[{"summary":"first second","count":2}]"#,
        ),
        (
            "summary: 123\n  words\ncount: 2",
            r#"{"summary":"123 words","count":2}"#,
        ),
        (
            "summary: &summary first\n  second\ncopy: *summary",
            r#"{"summary":"first second","copy":"first second"}"#,
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!(
                    "printf %s '{}\n' | yq -I 0 -p=yaml -o=json .",
                    yaml.replace('\'', "'\\''")
                ),
                ExecOptions {
                    cwd: Some("/".into()),
                    env: BTreeMap::from([
                        ("LC_ALL".into(), "C".into()),
                        ("TZ".into(), "UTC".into()),
                    ]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{yaml}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{yaml}");
        assert!(!result.used_typescript_bridge, "{yaml}");
        assert_eq!(result.stdout, format!("{expected}\n"), "{yaml}");
    }
}
