use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn walk_removes_empty_results_without_replacing_them_with_null() {
    for (input, expected) in [
        (r#"{"a":1,"b":{}}"#, "{\"a\":1}\n"),
        (
            r#"{"a":1,"b":{"c":{}},"d":null,"e":false}"#,
            "{\"a\":1,\"d\":null,\"e\":false}\n",
        ),
        (
            r#"[{}, {"a":{}}, {"a":1,"b":{}}, null]"#,
            "[{\"a\":1},null]\n",
        ),
        ("{}", ""),
        ("[]", "[]\n"),
        ("null", "null\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | jq -c 'walk(select(. != {{}}))'"),
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
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "", "{input}");
    }
}

#[test]
fn walk_preserves_filter_streams() {
    for (input, expected) in [
        ("1", "1\n11\n"),
        ("[1,2]", "[1,11,2,12]\n"),
        (r#"{"a":1,"b":2}"#, "{\"a\":1,\"b\":2}\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!(
                    "printf %s '{input}' | jq -c 'walk(if type == \"number\" then (., .+10) else . end)'"
                ),
                ExecOptions {
                    cwd: Some("/".into()),
                    env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "", "{input}");
    }
}

#[test]
fn walk_propagates_filter_errors_without_invalid_output() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            r#"printf %s '{"a":1,"b":{}}' | jq -c 'walk(if . == {} then error("empty object") else . end)'"#,
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 5, "{}", result.stderr);
    assert_eq!(result.stdout, "");
    assert!(result.stderr.contains("empty object"), "{}", result.stderr);
}
