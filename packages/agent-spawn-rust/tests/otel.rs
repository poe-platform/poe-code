use agent_spawn_rust::{Planner, otel::signal};
use mcp_protocol_rust::json::Value;
#[test]
fn telemetry_overlays_follow_declarative_definitions_and_aliases() {
    let planner = Planner::builtins();
    assert!(
        planner
            .telemetry_plan("pi", "http://127.0.0.1:1234", "id", false)
            .is_none()
    );
    assert!(
        planner
            .telemetry_plan("unknown", "http://127.0.0.1:1234", "id", false)
            .is_none()
    );
    let plan = planner
        .telemetry_plan("claude", "http://127.0.0.1:1234", "id", true)
        .unwrap();
    let env = plan.get("env").unwrap();
    assert_eq!(
        env.get("CLAUDE_CODE_ENABLE_TELEMETRY"),
        Some(&Value::String("1".encode_utf16().collect()))
    );
    assert_eq!(
        env.get("OTEL_RESOURCE_ATTRIBUTES"),
        Some(&Value::String(
            "poe.code.spawn.id=id".encode_utf16().collect()
        ))
    );
    assert_eq!(
        env.get("OTEL_LOG_TOOL_CONTENT"),
        Some(&Value::String("1".encode_utf16().collect()))
    );
    let plan = planner
        .telemetry_plan("codex", "http://127.0.0.1:1234", "id", false)
        .unwrap();
    let Value::Array(args) = plan.get("args").unwrap() else {
        panic!()
    };
    assert_eq!(args.len(), 6);
    assert!(args.iter().any(|arg| matches!(arg, Value::String(text) if String::from_utf16_lossy(text).contains("1234/v1/traces"))));
}
#[test]
fn receiver_signal_uses_exact_case_sensitive_suffixes() {
    for (path, expected) in [
        ("/v1/traces", Some("traces")),
        ("/prefix/v1/logs", Some("logs")),
        ("/v1/metrics", Some("metrics")),
        ("/v1/logs?query", None),
        ("/v1/LOGS", None),
        ("", None),
    ] {
        assert_eq!(signal(&path.encode_utf16().collect::<Vec<_>>()), expected);
    }
}
