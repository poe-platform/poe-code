use agent_spawn_rust::render::{Facts, convert, render_kind};
use mcp_protocol_rust::json::{self, Value};
#[test]
fn terminal_update_can_start_and_complete_with_prior_kind() {
    let input=json::parse(br#"{"sessionUpdate":"tool_call_update","toolCallId":"t","status":"failed","outputText":"done"}"#,Default::default()).unwrap();
    let result = convert(
        &input,
        Facts {
            started: false,
            prior_kind: Some(vec![101, 120, 101, 99]),
            prior_title: Some(vec![120]),
            numbers: vec![],
        },
    );
    assert_eq!(result.get("events").unwrap(),&Value::Array(vec![json::parse(br#"{"event":"tool_start","kind":"exec","title":"x","id":"t"}"#,Default::default()).unwrap(),json::parse(br#"{"event":"tool_complete","kind":"exec","path":"done","id":"t","status":"failed"}"#,Default::default()).unwrap()]));
    assert_eq!(result.get("start"), Some(&Value::Bool(true)));
    assert_eq!(render_kind(Some(&[0xd800])), vec![0xd800]);
}
#[test]
fn usage_preserves_nan_and_reported_usd_cost() {
    let input = json::parse(
        br#"{"sessionUpdate":"usage_update","usd":true}"#,
        Default::default(),
    )
    .unwrap();
    let result = convert(
        &input,
        Facts {
            started: false,
            prior_kind: None,
            prior_title: None,
            numbers: vec![
                Some(10.0),
                Some(20.0),
                Some(f64::NAN),
                Some(3.0),
                None,
                Some(0.1),
            ],
        },
    );
    if let Value::Array(events) = result.get("events").unwrap() {
        assert!(matches!(events[0].get("inputTokens"),Some(Value::Number(v))if v.is_nan()));
        assert_eq!(
            events[0].get("costSource"),
            Some(&Value::String("reported".encode_utf16().collect()))
        );
    }
}
