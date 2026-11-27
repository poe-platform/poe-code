use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn yq_removes_trailing_yaml_comments_without_changing_scalar_values() {
    for (yaml, expected) in [
        (
            "title: \"issue #7\" # editorial\ncount: 3 # units\n",
            "{\"title\":\"issue #7\",\"count\":3}\n",
        ),
        (
            "title: 'issue #7' # editorial\nplain: issue#7 # editorial\napostrophe: user's issue # editorial\nquote: say \"hello # editorial\ncount: 3\t# units\n",
            "{\"title\":\"issue #7\",\"plain\":\"issue#7\",\"apostrophe\":\"user's issue\",\"quote\":\"say \\\"hello\",\"count\":3}\n",
        ),
        (
            "values: # list\n  - 3 # units\n  - 'issue #7' # editorial\nempty: # nothing\nflag: true # enabled\n",
            "{\"values\":[3,\"issue #7\"],\"empty\":null,\"flag\":true}\n",
        ),
        (
            "values: [3, 'issue #7'] # editorial\nobject: {count: 3, title: 'issue #7'} # editorial\n",
            "{\"values\":[3,\"issue #7\"],\"object\":{\"count\":3,\"title\":\"issue #7\"}}\n",
        ),
        (
            "title: | # literal\n  issue #7\nfolded: > # folded\n  #7\n",
            "{\"title\":\"issue #7\\n\",\"folded\":\"#7\\n\"}\n",
        ),
        ("3 # units\n", "3\n"),
        ("'issue: #7' # editorial\n", "\"issue: #7\"\n"),
        (
            "title: &title 'issue #7' # editorial\ncopy: *title # reference\n",
            "{\"title\":\"issue #7\",\"copy\":\"issue #7\"}\n",
        ),
        ("- # entry\n  count: 3 # units\n", "[{\"count\":3}]\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let script = format!(
            "printf %s '{}' | yq -I 0 -p=yaml -o=json .",
            yaml.replace('\'', "'\\''")
        );
        let result = shell
            .exec_with_options(
                &script,
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
        assert_eq!(result.exit_code, 0, "{script}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{script}");
        assert_eq!(result.stdout, expected, "{script}");
    }
}

#[test]
fn yq_comments_leave_quoted_escape_sequences_unchanged() {
    for value in [
        r#""say \" #7""#,
        r#""path \\ #7""#,
        "'it''s #7'",
        r#""end \\""#,
    ] {
        let mut outputs = Vec::new();
        for comment in ["", " # editorial"] {
            let (mut shell, _) = Shell::with_memory_fs();
            let yaml = format!("title: {value}{comment}\n");
            let script = format!(
                "printf %s '{}' | yq -I 0 -p=yaml -o=json .",
                yaml.replace('\'', "'\\''")
            );
            let result = shell
                .exec_with_options(
                    &script,
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
            assert_eq!(result.exit_code, 0, "{script}: {}", result.stderr);
            assert_eq!(result.stderr, "", "{script}");
            outputs.push(result.stdout);
        }
        assert_eq!(outputs[0], outputs[1], "{value}");
    }
}
