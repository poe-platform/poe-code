use mcp_protocol_rust::{json::Limits, jsonrpc::Id};
use tiny_stdio_mcp_server_rust::wire::{LineMessage, parse_line};

fn line(source: &str) -> LineMessage {
    parse_line(
        &source.encode_utf16().collect::<Vec<_>>(),
        Limits::default(),
    )
}

#[test]
fn ignores_initialize_notifications_and_modern_requests_without_ids() {
    assert_eq!(
        line(r#"{"jsonrpc":"2.0","method":"initialize"}"#),
        LineMessage::Ignore
    );
    assert_eq!(
        line(
            r#"{"jsonrpc":"2.0","method":"tools/call","params":{"name":"echo","_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}"#
        ),
        LineMessage::Ignore
    );
    assert!(matches!(
        line(r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}"#),
        LineMessage::Dispatch(_)
    ));
}

#[test]
fn rejects_initialized_requests_without_changing_session_readiness() {
    let LineMessage::Error { id, error } =
        line(r#"{"jsonrpc":"2.0","id":"one","method":"notifications/initialized"}"#)
    else {
        panic!("Expected invalid request");
    };
    assert_eq!(id, Id::String("one".encode_utf16().collect()));
    assert_eq!(error.code, -32600);
    assert_eq!(error.message, "Invalid Request");
}

#[test]
fn dispatches_legacy_null_ids_and_preserves_utf16_wire_arguments() {
    let LineMessage::Dispatch(request) = line(
        r#"{"jsonrpc":"2.0","id":null,"method":"tools/call","params":{"name":"echo","arguments":{"text":"\ud800"}}}"#,
    ) else {
        panic!("Expected legacy request");
    };
    assert_eq!(request.id, Some(Id::Null));
    assert_eq!(
        request
            .params
            .unwrap()
            .get("arguments")
            .unwrap()
            .get("text")
            .unwrap(),
        &mcp_protocol_rust::json::Value::String(vec![0xd800])
    );
}

#[test]
fn malformed_lines_produce_wire_errors_with_recoverable_ids() {
    for (source, code, expected_id) in [
        ("", -32700, Id::Null),
        ("[1]", -32600, Id::Null),
        (
            r#"{"jsonrpc":"2.0","id":42,"method":"ping","params":null}"#,
            -32600,
            Id::Number(42.0),
        ),
    ] {
        let LineMessage::Error { id, error } = line(source) else {
            panic!("Expected error: {source}");
        };
        assert_eq!(id, expected_id);
        assert_eq!(error.code, code);
    }
}
