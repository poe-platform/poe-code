use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn csvjson_rejects_duplicate_keys_without_output() {
    for (options, input, key) in [
        ("--key k", "k,v\na,1\na,2\n", "a"),
        ("-k 1 -i 2", "k,v\na,1\nb,2\na,3\n", "a"),
        ("--key k", "k,v\n,1\n,2\n", ""),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("csvjson {options} <<'INPUT'\n{input}INPUT"),
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
        assert_eq!(result.exit_code, 1, "{options}: {result:?}");
        assert_eq!(result.stdout, "", "{options}");
        assert_eq!(
            result.stderr,
            format!("ValueError: Value {key} is not unique in the key column.\n"),
            "{options}"
        );
    }
}

#[test]
fn csvjson_preserves_unique_key_order_and_unkeyed_duplicate_rows() {
    for (options, input, expected) in [
        (
            "--key k",
            "k,v\nb,1\na,2\n",
            r#"{"b": {"k": "b", "v": 1.0}, "a": {"k": "a", "v": 2.0}}"#,
        ),
        ("--key k", "k,v\n", "{}"),
        (
            "",
            "k,v\na,1\na,2\n",
            r#"[{"k": "a", "v": 1.0}, {"k": "a", "v": 2.0}]"#,
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("csvjson {options}"),
                ExecOptions {
                    stdin: Some(input.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{options}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{options}");
        assert_eq!(result.stderr, "", "{options}");
    }
}
