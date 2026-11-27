use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn yq_yaml_preserves_integer_identifiers_in_json() {
    assert_integer_json("yaml", ": ");
}

#[test]
fn yq_toml_preserves_integer_identifiers_in_json() {
    assert_integer_json("toml", " = ");
}

fn assert_integer_json(format: &str, separator: &str) {
    for (input, expected) in [
        ("9007199254740993", "9007199254740993"),
        ("-9007199254740993", "-9007199254740993"),
        ("9223372036854775807", "9223372036854775807"),
        ("-9223372036854775808", "-9223372036854775808"),
        ("+9007199254740993", "9007199254740993"),
        ("42", "42"),
        ("0", "0"),
        ("1.25", "1.25"),
        ("1e3", "1000"),
        ("\"9007199254740993\"", "\"9007199254740993\""),
        (
            "[9007199254740993, -9007199254740993]",
            "[9007199254740993,-9007199254740993]",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let script = format!("printf %s 'id{separator}{input}\n' | yq -I 0 -p={format} -o=json .");
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
        assert_eq!(
            result.stdout,
            format!("{{\"id\":{expected}}}\n"),
            "{script}"
        );
    }
}
