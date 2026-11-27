use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn first_selects_only_the_first_element_path() {
    for (input, filter, expected) in [
        ("[1,2]", "pick(first)", "[1]\n"),
        ("[]", "pick(first)", "[null]\n"),
        ("null", "pick(first)", "[null]\n"),
        ("[[1,2],[3,4]]", "pick(first | first)", "[[1]]\n"),
        ("[1,2]", "path(first)", "[0]\n"),
        ("[1,2]", "first = 9", "[9,2]\n"),
    ] {
        let result = run(input, filter);
        assert_eq!(result.exit_code, 0, "{input} {filter}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input} {filter}");
        assert_eq!(result.stderr, "", "{input} {filter}");
    }
}

#[test]
fn first_rejects_inputs_that_cannot_be_indexed_by_number() {
    for input in ["{}", "3", "true", "\"abc\""] {
        let result = run(input, "pick(first)");
        assert_eq!(result.exit_code, 5, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, "", "{input}");
        assert!(result.stderr.contains("Cannot index"), "{}", result.stderr);
    }
}

fn run(input: &str, filter: &str) -> safe_bash_rust::ExecOutput {
    let (mut shell, _) = Shell::with_memory_fs();
    shell
        .exec_with_options(
            &format!("printf %s '{input}' | jq -c '{filter}'"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap()
}
