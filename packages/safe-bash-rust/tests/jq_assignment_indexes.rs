use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn jq_assignment_rejects_invalid_index_types_without_output() {
    for (input, filter, kind) in [
        ("{}", ".[{}] = 7", "object"),
        ("{}", ".[{}] |= 7", "object"),
        ("{}", ".[[]] = 7", "array"),
        ("{}", ".[true] = 7", "boolean"),
        ("{}", ".[null] = 7", "null"),
    ] {
        let result = run(input, filter);
        assert_eq!(result.exit_code, 5, "{filter}: {result:?}");
        assert_eq!(result.stdout, "", "{filter}");
        assert!(
            result
                .stderr
                .contains(&format!("Cannot index object with {kind}")),
            "{filter}: {}",
            result.stderr
        );
    }
}

#[test]
fn jq_assignment_preserves_valid_index_types_and_slices() {
    for (input, filter, expected) in [
        ("{}", r#".[("key")] = 7"#, "{\"key\":7}\n"),
        ("[1,2]", ".[(1)] = 7", "[1,7]\n"),
        ("[1,2]", ".[0:1] = [7]", "[7,2]\n"),
    ] {
        let result = run(input, filter);
        assert_eq!(result.exit_code, 0, "{filter}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{filter}");
        assert_eq!(result.stderr, "", "{filter}");
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
