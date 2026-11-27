use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn jq_builtin_argument_generators_preserve_outputs() {
    for (input, filter, expected) in [
        (r#"["a","b"]"#, r#"join(",","/")"#, "\"a,b\"\n\"a/b\"\n"),
        (
            r#"["a","b"]"#,
            r#"first(join(",",error("later")))"#,
            "\"a,b\"\n",
        ),
        (r#"["a","b"]"#, "join(empty)", ""),
        (r#"["a","b"]"#, "join(.[])", "\"aab\"\n\"abb\"\n"),
        ("[[[1]],2]", "flatten(1,2)", "[[1],2]\n[1,2]\n"),
        ("[[[1]],2]", "flatten(empty)", ""),
        (
            "[[[1]],2]",
            "first(flatten(1,error(\"later\")))",
            "[[1],2]\n",
        ),
        ("[[[1]],2]", "flatten(0,1,2)", "[[[1]],2]\n[[1],2]\n[1,2]\n"),
        (r#"{"a":1}"#, r#"has("a","b")"#, "true\nfalse\n"),
        (
            r#""a/b,c""#,
            r#"split(",","/")"#,
            "[\"a/b\",\"c\"]\n[\"a\",\"b,c\"]\n",
        ),
    ] {
        let result = run(input, filter);
        assert_eq!(result.exit_code, 0, "{filter}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{filter}");
        assert_eq!(result.stderr, "", "{filter}");
    }
}

#[test]
fn jq_flatten_rejects_invalid_generator_depths() {
    for filter in ["flatten(-1,1)", "flatten(\"bad\",1)"] {
        let result = run("[[[1]],2]", filter);
        assert_eq!(result.exit_code, 5, "{filter}: {}", result.stderr);
        assert_eq!(result.stdout, "", "{filter}");
        assert!(!result.stderr.is_empty(), "{filter}");
    }
}

#[test]
fn jq_flatten_keeps_valid_output_before_a_later_invalid_depth() {
    let result = run("[[[1]],2]", "flatten(1,-1)");
    assert_eq!(result.exit_code, 5);
    assert_eq!(result.stdout, "[[1],2]\n");
    assert!(!result.stderr.is_empty());
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
