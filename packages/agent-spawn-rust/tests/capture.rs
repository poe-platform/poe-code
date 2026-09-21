use agent_spawn_rust::capture::SessionCapture;
use mcp_protocol_rust::json::{self, Value};
fn v(text: &str) -> Value {
    json::parse_utf16(&text.encode_utf16().collect::<Vec<_>>(), Default::default()).unwrap()
}
#[test]
fn tool_slots_preserve_identity_and_anonymous_calls_remain_independent() {
    let mut state = SessionCapture::default();
    let start = state.observe(
        &v(r#"{"event":"tool_start","id":"one","kind":"exec","title":"run"}"#),
        true,
    );
    let end = state.observe(
        &v(r#"{"event":"tool_complete","id":"one","status":"failed"}"#),
        true,
    );
    assert_eq!(start.get("index"), end.get("index"));
    assert_eq!(
        end.get("fields"),
        Some(&v(r#"{"id":"one","status":"failed"}"#))
    );
    let first = state.observe(&v(r#"{"event":"tool_start","id":""}"#), true);
    let second = state.observe(&v(r#"{"event":"tool_complete","id":""}"#), true);
    assert_ne!(first.get("index"), second.get("index"));
}
#[test]
fn metadata_capture_never_retains_messages_or_tool_slots() {
    let mut state = SessionCapture::default();
    assert_eq!(
        state.observe(&v(r#"{"event":"agent_message","hasText":true}"#), false),
        Value::Null
    );
    assert_eq!(
        state.observe(&v(r#"{"event":"tool_start","id":"one"}"#), false),
        Value::Null
    );
    assert_eq!(
        state.observe(
            &v(r#"{"event":"session_start","threadId":"thread"}"#),
            false
        ),
        v(r#"{"type":"thread","threadId":"thread"}"#)
    );
    assert_eq!(
        state
            .observe(&v(r#"{"event":"tool_start","id":"one"}"#), true)
            .get("index"),
        Some(&Value::Number(0.0))
    );
}
#[test]
fn captured_billing_filters_negative_nonfinite_and_retains_optional_zero() {
    let mut usage =
        agent_spawn_rust::stream::Usage::with_initial([Some(f64::INFINITY), Some(4.0), None, None]);
    assert_eq!(
        usage.observe_nonnegative([Some(-1.0), Some(3.0), Some(0.0), Some(f64::NAN)]),
        v(r#"{"outputTokens":7,"cachedTokens":0}"#)
    );
    assert_eq!(
        usage.value().get("inputTokens"),
        Some(&Value::Number(f64::INFINITY))
    );
}
#[test]
fn typed_message_ingress_keeps_empty_and_metadata_only_messages_out() {
    assert!(agent_spawn_rust::capture::message(true, true));
    assert!(!agent_spawn_rust::capture::message(true, false));
    assert!(!agent_spawn_rust::capture::message(false, true));
}
