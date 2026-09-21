use mcp_protocol_rust::json::{self, Value};
use poe_acp_client_rust::layer::Layer;
fn v(source: &str) -> Value {
    json::parse_utf16(
        &source.encode_utf16().collect::<Vec<_>>(),
        Default::default(),
    )
    .unwrap()
}
#[test]
fn correlation_releases_pending_ids_and_shutdown_is_permanent() {
    let mut layer = Layer::new(1.0).unwrap();
    let method = "lookup".encode_utf16().collect::<Vec<_>>();
    let created = layer.request(&method, None, None).unwrap();
    assert_eq!(created.get("token"), Some(&v("1")));
    assert_eq!(layer.pending_count(), 1);
    assert!(
        layer
            .request(&method, None, Some(Value::Number(1.0)))
            .is_err()
    );
    let action = layer.incoming(
        &r#"{"jsonrpc":"2.0","id":1,"result":true}"#
            .encode_utf16()
            .collect::<Vec<_>>(),
    );
    assert_eq!(action.get("token"), Some(&v("1")));
    assert_eq!(layer.pending_count(), 0);
    layer.dispose();
    assert!(layer.request(&method, None, None).is_err());
}
#[test]
fn stream_chunks_and_handler_routing_are_independent() {
    let mut layer = Layer::new(0.0).unwrap();
    assert_eq!(
        layer.register("echo".encode_utf16().collect(), false, 7),
        None
    );
    assert!(
        layer
            .push(
                &r#"{"jsonrpc":"2.0","id":"a","method":"ec"#
                    .encode_utf16()
                    .collect::<Vec<_>>()
            )
            .unwrap()
            .is_empty()
    );
    let actions = layer
        .push(&"ho\"}\r\n{bad\n".encode_utf16().collect::<Vec<_>>())
        .unwrap();
    assert_eq!(actions.len(), 2);
    let Value::String(first) = &actions[0] else {
        panic!("framed source")
    };
    assert_eq!(layer.incoming(first).get("handler"), Some(&v("7")));
    let Value::String(second) = &actions[1] else {
        panic!("framed source")
    };
    assert_eq!(layer.incoming(second).get("type"), Some(&v("\"write\"")));
}
#[test]
fn completed_large_frame_releases_excess_capacity() {
    let mut layer = Layer::new(1.0).unwrap();
    let source = format!(
        r#"{{"jsonrpc":"2.0","method":"ignored","params":"{}"}}"#,
        "x".repeat(512 * 1024)
    ) + "\n";
    assert_eq!(
        layer
            .push(&source.encode_utf16().collect::<Vec<_>>())
            .unwrap()
            .len(),
        1
    );
    assert!(layer.retained_frame_capacity() <= 64 * 1024);
}
