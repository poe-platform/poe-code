use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn yq_keeps_indentless_sequences_inside_mapping_values() {
    for (input, expected) in [
        (
            "targets:\n- a\n- b\nname: docs\n",
            r#"{"targets":["a","b"],"name":"docs"}"#,
        ),
        (
            "config:\n  targets:\n  - a\n  - b\n  name: docs\nactive: true\n",
            r#"{"config":{"targets":["a","b"],"name":"docs"},"active":true}"#,
        ),
        (
            "targets:\n# comment\n\n- a\n-\nname: docs\n",
            r#"{"targets":["a",null],"name":"docs"}"#,
        ),
        (
            "targets:\n- name: first\n  enabled: true\n- name: second\nname: docs\n",
            r#"{"targets":[{"name":"first","enabled":true},{"name":"second"}],"name":"docs"}"#,
        ),
        (
            "targets: &items\n- a\n- b\ncopy: *items\nname: docs\n",
            r#"{"targets":["a","b"],"copy":["a","b"],"name":"docs"}"#,
        ),
        (
            "- targets:\n  - a\n  - b\n  name: docs\n- name: next\n",
            r#"[{"targets":["a","b"],"name":"docs"},{"name":"next"}]"#,
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | yq -I 0 -p=yaml -o=json ."),
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
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, format!("{expected}\n"), "{input}");
        assert_eq!(result.stderr, "", "{input}");
    }
}

#[test]
fn yq_preserves_sequence_and_mapping_boundaries() {
    for (input, expected) in [
        (
            "targets:\nname: docs\n",
            r#"{"targets":null,"name":"docs"}"#,
        ),
        (
            "targets:\n  - a\n  - b\nname: docs\n",
            r#"{"targets":["a","b"],"name":"docs"}"#,
        ),
        (
            "- targets:\n- name: docs\n",
            r#"[{"targets":null},{"name":"docs"}]"#,
        ),
        (
            "- targets:\n  name: docs\n",
            r#"[{"targets":null,"name":"docs"}]"#,
        ),
        (
            "-   targets:\n    - a\n    name: docs\n- name: next\n",
            r#"[{"targets":["a"],"name":"docs"},{"name":"next"}]"#,
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                "yq -I 0 -p=yaml -o=json .",
                ExecOptions {
                    stdin: Some(input.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, format!("{expected}\n"), "{input}");
        assert_eq!(result.stderr, "", "{input}");
    }
}
