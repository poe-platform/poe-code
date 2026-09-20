use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_mcp_client_rust::subscriptions::{SubscriptionState, normalize_filter};
fn value(text: &str) -> Value {
    json::parse_utf16(&text.encode_utf16().collect::<Vec<_>>(), Limits::default()).unwrap()
}
#[test]
fn filters_are_bounded_normalized_and_snapshot_owned() {
    assert_eq!(normalize_filter(&value(r#"{"toolsListChanged":false,"promptsListChanged":true,"resourceSubscriptions":["file:///a","file:///a","file:///b"],"unknown":true}"#)).unwrap(), value(r#"{"promptsListChanged":true,"resourceSubscriptions":["file:///a","file:///b"]}"#));
    for text in [
        "null",
        "[]",
        r#"{"toolsListChanged":1}"#,
        r#"{"resourceSubscriptions":[" file:///a"]}"#,
        r#"{"resourceSubscriptions":["file:///a%zz"]}"#,
    ] {
        assert!(normalize_filter(&value(text)).is_err(), "{text}");
    }
    let oversized = Value::Array(vec![
        Value::String("file:///a".encode_utf16().collect());
        1025
    ]);
    assert!(
        normalize_filter(&Value::Object(vec![(
            "resourceSubscriptions".encode_utf16().collect(),
            oversized
        )]))
        .is_err()
    );
}
#[test]
fn acknowledgements_are_correlated_subset_checked_and_once_only() {
    let mut state = SubscriptionState::default();
    let id = Value::Number(1.0);
    state
        .register(
            id.clone(),
            value(r#"{"toolsListChanged":true,"resourceSubscriptions":["file:///a"]}"#),
        )
        .unwrap();
    assert!(!state.accepts(
        "notifications/tools/list_changed",
        &value(r#"{"_meta":{"io.modelcontextprotocol/subscriptionId":1}}"#)
    ));
    assert!(
        state
            .acknowledge(&value(
                r#"{"_meta":{"io.modelcontextprotocol/subscriptionId":99},"notifications":{}}"#
            ))
            .unwrap()
            .is_none()
    );
    assert!(state.acknowledge(&value(r#"{"_meta":{"io.modelcontextprotocol/subscriptionId":1},"notifications":{"promptsListChanged":true}}"#)).is_err());
    assert!(state.acknowledge(&value(r#"{"_meta":{"io.modelcontextprotocol/subscriptionId":1},"notifications":{"toolsListChanged":true,"resourceSubscriptions":["file:///a"]}}"#)).unwrap().is_some());
    assert!(state.accepts(
        "notifications/tools/list_changed",
        &value(r#"{"_meta":{"io.modelcontextprotocol/subscriptionId":1}}"#)
    ));
    assert!(!state.accepts(
        "notifications/resources/updated",
        &value(r#"{"uri":"file:///b","_meta":{"io.modelcontextprotocol/subscriptionId":1}}"#)
    ));
    assert!(state.acknowledge(&value(r#"{"_meta":{"io.modelcontextprotocol/subscriptionId":1},"notifications":{"promptsListChanged":true}}"#)).unwrap().is_none());
    state
        .validate_completion(
            &id,
            &value(r#"{"_meta":{"io.modelcontextprotocol/subscriptionId":1}}"#),
        )
        .unwrap();
    state.remove(&id);
    assert!(!state.accepts(
        "notifications/tools/list_changed",
        &value(r#"{"_meta":{"io.modelcontextprotocol/subscriptionId":1}}"#)
    ));
}
#[test]
fn limits_and_completion_errors_do_not_leak_entries() {
    let mut state = SubscriptionState::default();
    for id in 0..64 {
        state
            .register(Value::Number(id as f64), value("{}"))
            .unwrap();
    }
    assert!(state.register(Value::Number(64.0), value("{}")).is_err());
    assert!(
        state
            .validate_completion(
                &Value::Number(1.0),
                &value(r#"{"_meta":{"io.modelcontextprotocol/subscriptionId":1}}"#)
            )
            .is_err()
    );
    state.remove(&Value::Number(1.0));
    state.register(Value::Number(64.0), value("{}")).unwrap();
    state.clear();
    assert_eq!(state.len(), 0);
}
