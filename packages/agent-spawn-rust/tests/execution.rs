use agent_spawn_rust::{Planner, execution};
use mcp_protocol_rust::json::{self, Value};
fn v(source: &str) -> Value {
    json::parse_utf16(
        &source.encode_utf16().collect::<Vec<_>>(),
        Default::default(),
    )
    .unwrap()
}
#[test]
fn execution_selects_stdin_from_the_same_declarative_policy_as_arguments() {
    let p = Planner::builtins();
    assert_eq!(
        p.selected_stdin("codex", &v(r#"{"prompt":"short"}"#))
            .unwrap(),
        None
    );
    assert!(
        p.selected_stdin("codex", &v(r#"{"prompt":"short","useStdin":true}"#))
            .unwrap()
            .is_some()
    );
    assert!(
        p.selected_stdin("codex", &v(r#"{"prompt":"a\u0000b"}"#))
            .unwrap()
            .is_some()
    );
    assert_eq!(
        p.selected_stdin("opencode", &v(r#"{"prompt":"short","useStdin":true}"#))
            .unwrap(),
        None
    );
    let short = Value::Object(vec![(
        "prompt".encode_utf16().collect(),
        Value::String(vec![120; 65536]),
    )]);
    let long = Value::Object(vec![(
        "prompt".encode_utf16().collect(),
        Value::String(vec![120; 65537]),
    )]);
    assert_eq!(p.selected_stdin("codex", &short).unwrap(), None);
    assert!(p.selected_stdin("codex", &long).unwrap().is_some());
    assert!(p.selected_stdin("unknown", &short).is_err());
}
#[test]
fn mcp_merge_recurses_only_into_objects_and_retains_caller_bytes_for_host_restore() {
    let before = v(r#"{"other":true,"mcpServers":{"old":{"command":"old","args":["a"]}}}"#);
    let after = v(r#"{"mcpServers":{"old":{"args":["b"]},"new":{"command":"new"}}}"#);
    assert_eq!(
        execution::merge_mcp(&before, &after).unwrap(),
        v(
            r#"{"other":true,"mcpServers":{"old":{"command":"old","args":["b"]},"new":{"command":"new"}}}"#
        )
    );
    assert!(execution::merge_mcp(&Value::Null, &after).is_err());
    assert!(execution::merge_mcp(&v("[]"), &after).is_err());
}

#[test]
fn streaming_stdin_placement_is_distinct_from_captured_cli_launches() {
    let p = Planner::builtins();
    let built = p
        .build(
            "codex",
            &v(r#"{"prompt":"secret","useStdin":true,"streamingTransport":true}"#),
            None,
        )
        .unwrap();
    let Value::Array(args) = built.get("args").unwrap() else {
        panic!()
    };
    assert_eq!(args.last(), Some(&v(r#""-""#)));
    assert!(!args.contains(&v(r#""secret""#)));
}

#[test]
fn interactive_transport_uses_interactive_catalog_arguments_without_print_mode() {
    let p = Planner::builtins();
    let built = p
        .build(
            "codex",
            &v(r#"{"prompt":"secret","mode":"read","interactiveTransport":true}"#),
            None,
        )
        .unwrap();
    assert_eq!(
        built.get("args"),
        Some(&v(
            r#"["secret","-a","never","-s","read-only","--enable","use_legacy_landlock"]"#
        ))
    );
    assert_eq!(
        built.get("displayArgs"),
        Some(&v(
            r#"["[prompt redacted]","-a","never","-s","read-only","--enable","use_legacy_landlock"]"#
        ))
    );
    let empty = p
        .build(
            "claude-code",
            &v(r#"{"prompt":"","interactiveTransport":true}"#),
            None,
        )
        .unwrap();
    let Value::Array(args) = empty.get("args").unwrap() else {
        panic!()
    };
    assert!(!args.contains(&v(r#""-p""#)));
}

#[test]
fn acp_permissions_prioritize_single_rejection_and_stop_reasons_are_explicit() {
    assert_eq!(
        execution::acp_rejection(&v(
            r#"[{"kind":"reject_always","optionId":"all"},{"kind":"reject_once","optionId":"one"}]"#
        )),
        v(r#"{"outcome":"selected","optionId":"one"}"#)
    );
    assert_eq!(
        execution::acp_rejection(&v(r#"[{"kind":"allow_once","optionId":"allow"}]"#)),
        v(r#"{"outcome":"cancelled"}"#)
    );
    assert_eq!(execution::acp_exit_code("completed"), 0);
    assert_eq!(execution::acp_exit_code("end_turn"), 0);
    assert_eq!(execution::acp_exit_code("cancelled"), 1);
}
