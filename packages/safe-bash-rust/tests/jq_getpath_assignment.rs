use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn getpath_updates_the_selected_value() {
    for (input, filter, expected) in [
        (
            r#"{"a":[{"b":2}]}"#,
            r#"getpath(["a",0,"b"]) |= 5"#,
            r#"{"a":[{"b":5}]}"#,
        ),
        (
            r#"{"a":[{"b":2}]}"#,
            r#"getpath(["a",0,"b"]) |= . + 3"#,
            r#"{"a":[{"b":5}]}"#,
        ),
        (
            r#"{"a":[{"b":2}]}"#,
            r#"getpath(["a"]) | getpath([0,"b"]) |= 5"#,
            r#"[{"b":5}]"#,
        ),
        (
            r#"{"a":[{"b":2}]}"#,
            r#"(getpath(["a"]) | getpath([0,"b"])) = 5"#,
            r#"{"a":[{"b":5}]}"#,
        ),
        ("[1,2]", "getpath([0],[1]) |= . + 1", "[2,3]"),
        (
            r#"{"key":"a","a":2}"#,
            "getpath([.key]) = 5",
            r#"{"key":"a","a":5}"#,
        ),
        ("[1,2]", "getpath([-1]) = 5", "[1,5]"),
        ("null", r#"getpath(["a",0,"b"]) = 5"#, r#"{"a":[{"b":5}]}"#),
        ("2", "getpath([]) |= . + 3", "5"),
        ("[1,2]", "getpath([0]) |= empty", "[2]"),
        ("[1,2]", "path(getpath([1]))", "[1]"),
        ("[1,2]", "pick(getpath([0]))", "[1]"),
        ("[1,2]", "del(getpath([0]))", "[2]"),
    ] {
        let result = run(input, filter);
        assert_eq!(result.exit_code, 0, "{filter}: {}", result.stderr);
        assert_eq!(result.stdout, format!("{expected}\n"), "{filter}");
        assert_eq!(result.stderr, "", "{filter}");
    }
}

#[test]
fn getpath_assignment_rejects_invalid_paths_without_output() {
    for (input, filter) in [
        ("{}", r#"getpath("a") |= 5"#),
        ("{}", "getpath([true]) = 5"),
        (r#"{"a":2}"#, r#"getpath(["a","b"]) |= 5"#),
    ] {
        let result = run(input, filter);
        assert_eq!(result.exit_code, 5, "{filter}: {}", result.stderr);
        assert_eq!(result.stdout, "", "{filter}");
        assert!(!result.stderr.is_empty(), "{filter}");
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
