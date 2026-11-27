use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn yq_decodes_dotted_toml_table_headers() {
    for (input, expression, expected) in [
        (
            "[service.cache]\nttl=42\n",
            ".",
            r#"{"service":{"cache":{"ttl":42}}}"#,
        ),
        ("[service.cache]\nttl=42\n", ".service.cache.ttl", "42"),
        (
            "[service.cache]\nttl=42\n[service]\nname=\"api\"\n[service.db]\nport=5432\n",
            ".",
            r#"{"service":{"cache":{"ttl":42},"name":"api","db":{"port":5432}}}"#,
        ),
        (
            "[ service . cache . limits ]\nmax=5\n",
            ".",
            r#"{"service":{"cache":{"limits":{"max":5}}}}"#,
        ),
        ("[service.cache]\n", ".", r#"{"service":{"cache":{}}}"#),
        (
            "[service.\"cache.local\"]\nttl=42\n",
            ".",
            r#"{"service":{"cache.local":{"ttl":42}}}"#,
        ),
        (
            "['service.cache']\nttl=42\n",
            ".",
            r#"{"service.cache":{"ttl":42}}"#,
        ),
        (
            "[[service.cache]]\nttl=42\n[[service.cache]]\nttl=60\n",
            ".",
            r#"{"service":{"cache":[{"ttl":42},{"ttl":60}]}}"#,
        ),
        (
            "[[service]]\nname=\"api\"\n[service.cache]\nttl=42\n[[service]]\nname=\"web\"\n[service.cache]\nttl=60\n",
            ".",
            r#"{"service":[{"name":"api","cache":{"ttl":42}},{"name":"web","cache":{"ttl":60}}]}"#,
        ),
        (
            "name=\"api\"\n[cache]\nttl=42\n",
            ".",
            r#"{"name":"api","cache":{"ttl":42}}"#,
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let quoted_input = input.replace('\'', "'\\''");
        let result = shell
            .exec_with_options(
                &format!("printf %s '{quoted_input}' | yq -I 0 -p=toml -o=json {expression}"),
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
        assert_eq!(
            result.stdout,
            format!("{expected}\n"),
            "{input}: {expression}"
        );
        assert_eq!(result.stderr, "", "{input}");
    }
}
