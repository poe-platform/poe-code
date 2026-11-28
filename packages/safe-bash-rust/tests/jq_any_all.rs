use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn any_all_stop_generators_after_a_decisive_predicate() {
    for (filter, expected) in [
        (r#"any((1,error("late")); .>0)"#, "true\n"),
        (r#"all((0,error("late")); .>0)"#, "false\n"),
        (r#"any((0,1,error("late")); .>0)"#, "true\n"),
        (r#"all((1,0,error("late")); .>0)"#, "false\n"),
        (r#"any(1; (true,error("late")))"#, "true\n"),
        (r#"all(1; (false,error("late")))"#, "false\n"),
    ] {
        assert_result(filter, 0, expected, "");
    }
}

#[test]
fn any_all_reduce_every_predicate_output_until_decided() {
    for (filter, expected) in [
        ("any(empty; .)", "false\n"),
        ("all(empty; .)", "true\n"),
        ("any(1; empty)", "false\n"),
        ("all(1; empty)", "true\n"),
        ("any((0,1); .>0)", "true\n"),
        ("all((0,1); .>=0)", "true\n"),
        ("any((false,null); .)", "false\n"),
        ("any((false,0); .)", "true\n"),
        ("all((0,[]); .)", "true\n"),
        ("all(1; (true,false))", "false\n"),
        ("any(1; (false,true))", "true\n"),
    ] {
        assert_result(filter, 0, expected, "");
    }
}

#[test]
fn any_all_propagate_errors_before_a_decision() {
    for filter in [
        r#"any((0,error("early")); .>0)"#,
        r#"all((1,error("early")); .>0)"#,
        r#"any(1; (false,error("early")))"#,
        r#"all(1; (true,error("early")))"#,
    ] {
        assert_result(filter, 5, "", "jq: error (at <stdin>:1): early\n");
    }
}

fn assert_result(filter: &str, code: i32, stdout: &str, stderr: &str) {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            &format!("printf %s 'null\n' | jq -c '{filter}'"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, code, "{filter}: {}", result.stderr);
    assert_eq!(result.stdout, stdout, "{filter}");
    assert_eq!(result.stderr, stderr, "{filter}");
}
