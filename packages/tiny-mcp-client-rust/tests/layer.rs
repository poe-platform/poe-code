use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_mcp_client_rust::layer::{Event, MessageLayer};

fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}
fn units(source: &str) -> Vec<u16> {
    source.encode_utf16().collect()
}

#[test]
fn outgoing_capacity_and_response_matching_are_independent_of_incoming_work() {
    let mut layer = MessageLayer::new(1).unwrap();
    let exchange = layer.begin_exchange().unwrap();
    let request = layer
        .prepare_request(exchange, units("ping"), None, None)
        .unwrap();
    assert_eq!(request.get("id"), Some(&Value::Number(1.0)));
    assert!(layer.begin_exchange().is_err());
    layer.feed(&units(r#"[{"jsonrpc":"2.0","id":"1","result":"wrong"},{"jsonrpc":"2.0","id":1,"result":"right"}]"#)).unwrap();
    let Some(Event::Settle { id, result, error }) = layer.next_event() else {
        panic!("settlement expected");
    };
    assert_eq!(id, 1);
    assert_eq!(result, Some(value("\"right\"")));
    assert_eq!(error, None);
    assert!(layer.next_event().is_none());
    assert!(layer.begin_exchange().is_err()); // retries retain exchange capacity
    assert!(layer.finish_exchange(exchange));
    assert!(layer.begin_exchange().is_ok());
}

#[test]
fn incoming_cancellation_retains_capacity_and_identity_until_settlement() {
    let mut layer = MessageLayer::new(1).unwrap();
    layer.register_request(units("held"));
    layer
        .feed(&units(r#"{"jsonrpc":"2.0","id":"a","method":"held"}"#))
        .unwrap();
    let Some(Event::Invoke { token, .. }) = layer.next_event() else {
        panic!("invocation expected");
    };
    layer.feed(&units(r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"a","reason":"stop"}}"#)).unwrap();
    assert!(
        matches!(layer.next_event(), Some(Event::Cancel { token: canceled, .. }) if canceled == token)
    );
    assert!(matches!(
        layer.next_event(),
        Some(Event::Notification { .. })
    ));
    layer
        .feed(&units(r#"{"jsonrpc":"2.0","id":"a","method":"held"}"#))
        .unwrap();
    let Some(Event::Write(reply)) = layer.next_event() else {
        panic!("duplicate error expected");
    };
    assert_eq!(
        reply.get("error").and_then(|error| error.get("code")),
        Some(&Value::Number(-32600.0))
    );
    layer
        .feed(&units(r#"{"jsonrpc":"2.0","id":"b","method":"held"}"#))
        .unwrap();
    let Some(Event::Write(reply)) = layer.next_event() else {
        panic!("capacity error expected");
    };
    assert_eq!(
        reply.get("error").and_then(|error| error.get("code")),
        Some(&Value::Number(-32000.0))
    );
    assert!(layer.complete_incoming(token, Ok(value("{}"))).is_none());
    assert!(layer.finish_incoming(token));
    assert!(!layer.finish_incoming(token));
}

#[test]
fn modern_metadata_overrides_supplied_fields_and_rejects_server_initiated_requests() {
    let mut layer = MessageLayer::new(1).unwrap();
    let exchange = layer.begin_exchange().unwrap();
    let request = layer
        .prepare_request(
            exchange,
            units("ping"),
            Some(value(r#"{"_meta":{"caller":1,"authoritative":false}}"#)),
            Some(value(r#"{"authoritative":true}"#)),
        )
        .unwrap();
    assert_eq!(
        request.get("params").and_then(|params| params.get("_meta")),
        Some(&value(r#"{"caller":1,"authoritative":true}"#))
    );
    layer.set_modern(true);
    layer.register_request(units("ping"));
    layer
        .feed(&units(r#"{"jsonrpc":"2.0","id":7,"method":"ping"}"#))
        .unwrap();
    let Some(Event::Write(reply)) = layer.next_event() else {
        panic!("modern request error expected");
    };
    assert_eq!(
        reply.get("error").and_then(|error| error.get("message")),
        Some(&value(
            "\"Modern MCP servers cannot initiate JSON-RPC requests\""
        ))
    );
}

#[test]
fn disposal_and_cancellation_remove_outgoing_work_and_suppress_late_callbacks() {
    let mut layer = MessageLayer::new(2).unwrap();
    let exchange = layer.begin_exchange().unwrap();
    layer
        .prepare_request(exchange, units("one"), None, None)
        .unwrap();
    assert!(layer.cancel_request(1));
    assert!(!layer.cancel_request(1));
    layer.dispose();
    assert!(layer.begin_exchange().is_err());
    assert!(
        layer
            .prepare_request(exchange, units("two"), None, None)
            .is_err()
    );
    layer
        .feed(&units(r#"{"jsonrpc":"2.0","id":1,"result":"late"}"#))
        .unwrap();
    assert!(layer.next_event().is_none());
}
