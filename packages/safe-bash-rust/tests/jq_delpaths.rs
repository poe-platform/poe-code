use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn delpaths_rejects_malformed_arguments_without_output() {
    for (argument, error) in [
        ("0", "Paths must be specified as an array"),
        ("null", "Paths must be specified as an array"),
        ("false", "Paths must be specified as an array"),
        ("\"keep\"", "Paths must be specified as an array"),
        ("{}", "Paths must be specified as an array"),
        ("[0]", "Path must be specified as array, not number"),
        (
            "[[\"keep\"],0]",
            "Path must be specified as array, not number",
        ),
    ] {
        let result = run(argument);
        assert_eq!(result.exit_code, 5, "{argument}: {}", result.stderr);
        assert_eq!(result.stdout, "", "{argument}");
        assert!(
            result.stderr.contains(error),
            "{argument}: {}",
            result.stderr
        );
    }
}

#[test]
fn delpaths_accepts_empty_and_valid_path_arrays() {
    for (argument, expected) in [("[]", "{\"keep\":5}\n"), ("[[\"keep\"]]", "{}\n")] {
        let result = run(argument);
        assert_eq!(result.exit_code, 0, "{argument}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{argument}");
        assert_eq!(result.stderr, "", "{argument}");
    }
}

fn run(argument: &str) -> safe_bash_rust::ExecOutput {
    let (mut shell, _) = Shell::with_memory_fs();
    shell
        .exec_with_options(
            &format!("printf %s '{{\"keep\":5}}' | jq -c 'delpaths({argument})'"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap()
}
