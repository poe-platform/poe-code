use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn quoted_toml_dotted_key_survives_shell_pipeline() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "printf %s '\"cache.ttl\"=5\n' | yq -I 0 -p=toml -o=json .",
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "{\"cache.ttl\":5}\n");
    assert_eq!(result.stderr, "");
}

#[test]
fn toml_assignment_keys_only_split_unquoted_dots() {
    for (input, expected) in [
        ("cache.ttl=5", r#"{"cache":{"ttl":5}}"#),
        ("'cache.ttl'=5", r#"{"cache.ttl":5}"#),
        (
            r#"cache . "time.to.live" = 5"#,
            r#"{"cache":{"time.to.live":5}}"#,
        ),
        (
            r#""cache.name" . 'time.to.live' = 5"#,
            r#"{"cache.name":{"time.to.live":5}}"#,
        ),
        (r#""".ttl=5"#, r#"{"":{"ttl":5}}"#),
        (r#""缓存.ttl"=5"#, r#"{"缓存.ttl":5}"#),
        (r#"'cache".ttl'=5"#, r#"{"cache\".ttl":5}"#),
        (
            "[cache]\n\"time.to.live\"=5",
            r#"{"cache":{"time.to.live":5}}"#,
        ),
        (
            "[[cache]]\n\"time.to.live\"=5",
            r#"{"cache":[{"time.to.live":5}]}"#,
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                "yq -I 0 -p=toml -o=json .",
                ExecOptions {
                    stdin: Some(input.into()),
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
