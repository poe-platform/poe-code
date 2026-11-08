use mcp_protocol_rust::json::{self, Limits, Value};
use std::sync::Arc;
use tiny_mcp_client_rust::http::HttpResponseMessages;

#[test]
fn shared_request_snapshot_survives_plan_drop_and_is_released_after_stream_completion() {
    let request = Arc::new(value(r#"{"jsonrpc":"2.0","id":"shared","method":"ping"}"#));
    let weak = Arc::downgrade(&request);
    let mut context = HttpResponseMessages::from_shared(request.clone()).unwrap();
    assert_eq!(Arc::strong_count(&request), 2);
    drop(request);
    assert!(weak.upgrade().is_some());
    context
        .validate(
            &units(r#"{"jsonrpc":"2.0","id":"shared","result":{}}"#),
            false,
        )
        .unwrap();
    drop(context);
    assert!(weak.upgrade().is_none());
}
fn value(text: &str) -> Value {
    json::parse_utf16(&text.encode_utf16().collect::<Vec<_>>(), Limits::default()).unwrap()
}
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn request_responses_match_ids_and_normalize_only_error_null_ids() {
    let mut messages =
        HttpResponseMessages::new(value(r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#)).unwrap();
    assert!(
        messages
            .validate(&units(r#"{"jsonrpc":"2.0","id":2,"result":{}}"#), true)
            .is_err()
    );
    let normalized = messages
        .validate(
            &units(r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"bad"}}"#),
            false,
        )
        .unwrap();
    assert_eq!(
        value(&String::from_utf16(&normalized).unwrap()).get("id"),
        Some(&Value::Number(1.0))
    );
    assert!(messages.completed());
    assert!(messages.validate(&normalized, true).is_err());
}
#[test]
fn subscription_acknowledgement_precedes_selected_notifications_and_completion() {
    let mut messages = HttpResponseMessages::new(value(
        r#"{"jsonrpc":"2.0","id":"sub","method":"subscriptions/listen"}"#,
    ))
    .unwrap();
    let changed = units(
        r#"{"jsonrpc":"2.0","method":"notifications/tools/list_changed","params":{"_meta":{"io.modelcontextprotocol/subscriptionId":"sub"}}}"#,
    );
    assert!(messages.validate(&changed, true).is_err());
    let ack = units(
        r#"{"jsonrpc":"2.0","method":"notifications/subscriptions/acknowledged","params":{"_meta":{"io.modelcontextprotocol/subscriptionId":"sub"}}}"#,
    );
    messages.validate(&ack, true).unwrap();
    assert!(messages.validate(&ack, true).is_err());
    messages.validate(&changed, true).unwrap();
    messages.validate(&units(r#"{"jsonrpc":"2.0","id":"sub","result":{"_meta":{"io.modelcontextprotocol/subscriptionId":"sub"}}}"#), true).unwrap();
}
#[test]
fn progress_is_correlated_and_notifications_are_not_allowed_in_single_json_results() {
    let request = value(
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"_meta":{"progressToken":"p"}}}"#,
    );
    let mut messages = HttpResponseMessages::new(request).unwrap();
    let progress = units(
        r#"{"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"p"}}"#,
    );
    assert!(messages.validate(&progress, false).is_err());
    messages.validate(&progress, true).unwrap();
    assert!(messages.validate(&units(r#"{"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"other"}}"#), true).is_err());
    assert!(
        messages
            .validate(
                &units(r#"{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}"#),
                true
            )
            .is_err()
    );
}
