use mcp_protocol_rust::json::{self, Value};
use poe_acp_client_rust::{report, stream::Collector};
fn v(source: &str) -> Value {
    json::parse_utf16(
        &source.encode_utf16().collect::<Vec<_>>(),
        Default::default(),
    )
    .unwrap()
}
#[test]
fn report_policy_collects_usage_errors_and_redacts_output() {
    let mut c = Collector::default();
    c.push(v(r#"{"sessionUpdate":"tool_call","toolCallId":"t","title":"Read","status":"failed","rawOutput":"private","rawInput":null}"#)).unwrap();
    c.push(v(r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"run","update":{"sessionUpdate":"usage_update","used":2,"size":3,"cost":null}}}"#)).unwrap();
    let r = report::generate(
        &c,
        &v(r#"{"startTime":"s","endTime":"e","errors":["extra",""]}"#),
    )
    .unwrap();
    assert_eq!(r.get("runId"), Some(&v(r#""run""#)));
    assert_eq!(r.get("exitStatus"), Some(&v(r#""failed""#)));
    assert_eq!(
        r.get("usage"),
        Some(&v(r#"{"used":2,"size":3,"updates":1,"cost":null}"#))
    );
    let redacted = report::redact(&r);
    assert_eq!(
        redacted.get("errors"),
        Some(&v(
            r#"[{"toolCallId":"t","message":"[redacted]"},{"message":"extra"}]"#
        ))
    );
    assert_eq!(report::safe_segment("../a😀"), "---a-");
}
#[test]
fn impossible_usage_and_invalid_exit_status_reject() {
    let mut c = Collector::default();
    c.push(v(r#"{"sessionUpdate":"usage_update","used":-1,"size":0}"#))
        .unwrap();
    assert!(
        report::generate(&c, &v(r#"{"runId":"r"}"#))
            .unwrap_err()
            .contains("usage.used")
    );
    let c = Collector::default();
    assert!(report::generate(&c, &v(r#"{"runId":"r","exitStatus":"x"}"#)).is_err());
}
