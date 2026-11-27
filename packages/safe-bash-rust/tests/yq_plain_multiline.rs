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

#[test]
fn yq_folds_plain_multiline_mapping_values() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "printf %s 'summary: first line\n  second line\ncount: 2\n' | yq -I 0 -p=yaml -o=json .",
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
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(
        result.stdout,
        "{\"summary\":\"first line second line\",\"count\":2}\n"
    );
}

#[test]
fn yq_folds_continuations_without_consuming_sibling_nodes() {
    for (input, expected) in [
        (
            "outer:\n  summary: first line  \n    second line\n      third line\n  count: 2\nlast: true\n",
            "{\"outer\":{\"summary\":\"first line second line third line\",\"count\":2},\"last\":true}\n",
        ),
        (
            "- first line\n  second line\n- next item\n",
            "[\"first line second line\",\"next item\"]\n",
        ),
        (
            "- summary: first line\n    second line\n  count: 2\n- summary: next item\n",
            "[{\"summary\":\"first line second line\",\"count\":2},{\"summary\":\"next item\"}]\n",
        ),
        (
            "summary: &summary first line\n  second line\ncopy: *summary\n",
            "{\"summary\":\"first line second line\",\"copy\":\"first line second line\"}\n",
        ),
        (
            "summary: 123\n  words\ncount: 2\n",
            "{\"summary\":\"123 words\",\"count\":2}\n",
        ),
        (
            "summary: first line\n  second line\nquoted: \"two words\"\nflow: [1, 2]\nblock: |\n  literal line\n  second line\n",
            "{\"summary\":\"first line second line\",\"quoted\":\"two words\",\"flow\":[1,2],\"block\":\"literal line\\nsecond line\\n\"}\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                "yq -I 0 -p=yaml -o=json .",
                ExecOptions {
                    cwd: Some("/".into()),
                    stdin: Some(input.into()),
                    env: BTreeMap::from([
                        ("LC_ALL".into(), "C".into()),
                        ("TZ".into(), "UTC".into()),
                    ]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{input}");
        assert_eq!(result.stdout, expected, "{input}");
    }
}
