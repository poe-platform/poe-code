use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_http_mcp_server_rust::policy::Policy;
fn v(s: &str) -> Value {
    json::parse(s.as_bytes(), Limits::default()).unwrap()
}
#[test]
fn configuration_limits_validate_numbers_and_keep_business_defaults() {
    let policy = Policy::new(&v("{}")).unwrap();
    assert_eq!(
        policy.settings().get("maxSessions"),
        Some(&Value::Number(128.0))
    );
    assert_eq!(policy.settings().get("maxRequestBytes"), None);
    for invalid in ["null", "false", "1.5", "0", "-1"] {
        let input = v(&format!("{{\"maxSessions\":{invalid}}}"));
        assert_eq!(
            Policy::new(&input).unwrap_err(),
            "maxSessions must be an integer greater than or equal to 1."
        );
    }
    assert!(
        Policy::new(&v(
            r#"{"maxSseEventHistory":0,"maxStreamBufferBytes":0,"sseKeepAliveMs":0}"#
        ))
        .is_ok()
    );
}
#[test]
fn request_admission_rejects_untrusted_hosts_and_modern_get_but_allows_same_origin() {
    let policy = Policy::new(&v("{}")).unwrap();
    let input = v(
        r#"{"method":"GET","headers":{"host":"LOCALHOST:8080","origin":"http://localhost:8080"},"endpointOrigin":"http://localhost:8080"}"#,
    );
    assert_eq!(
        policy.call("http", &input).get("route"),
        Some(&v("\"GET\""))
    );
    let input = v(r#"{"method":"GET","headers":{"host":"bad.example"}}"#);
    assert_eq!(
        policy
            .call("http", &input)
            .get("rejection")
            .unwrap()
            .get("status"),
        Some(&Value::Number(403.0))
    );
    let input = v(
        r#"{"method":"GET","headers":{"host":"[::1]:8080","mcp-protocol-version":"2026-07-28"}}"#,
    );
    assert_eq!(
        policy
            .call("http", &input)
            .get("rejection")
            .unwrap()
            .get("status"),
        Some(&Value::Number(405.0))
    );
}
#[test]
fn modern_single_message_and_accept_requirements_precede_header_mirrors() {
    let policy = Policy::new(&v("{}")).unwrap();
    let out = policy.call(
        "modern",
        &v(r#"{"isBatch":true,"messages":[],"headers":{}}"#),
    );
    assert_eq!(out.get("status"), Some(&Value::Number(400.0)));
    let out=policy.call("modern",&v(r#"{"isBatch":false,"messages":[{"method":"ping","id":1}],"headers":{"accept":"application/json"}}"#));
    assert_eq!(out.get("status"), Some(&Value::Number(406.0)));
}
#[test]
fn session_and_tool_admission_preserve_legacy_exceptions() {
    let policy = Policy::new(&v(r#"{"maxConcurrentToolCalls":1}"#)).unwrap();
    assert_eq!(
        policy.call(
            "message",
            &v(r#"{"method":"ping","initialized":false,"stateful":true}"#)
        ),
        Value::Null
    );
    assert_eq!(
        policy
            .call(
                "message",
                &v(r#"{"method":"tools/list","initialized":false,"stateful":true}"#)
            )
            .get("message"),
        Some(&v("\"Session not initialized\""))
    );
    assert_eq!(
        policy
            .call(
                "message",
                &v(r#"{"method":"tools/call","initialized":true,"stateful":true,"active":1}"#)
            )
            .get("code"),
        Some(&Value::Number(-32000.0))
    );
    assert_eq!(
        policy
            .call(
                "message",
                &v(r#"{"method":"resources/subscribe","stateful":false}"#)
            )
            .get("code"),
        Some(&Value::Number(-32601.0))
    );
}
