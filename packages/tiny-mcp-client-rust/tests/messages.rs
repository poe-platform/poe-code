use mcp_protocol_rust::json::Value;
use tiny_mcp_client_rust::messages::{ParsedMessage, parse_message};

#[test]
fn accepts_client_response_and_notification_shapes_without_server_request_rules() {
    for line in [
        r#"{"jsonrpc":"2.0","id":1,"result":null}"#,
        r#"{"jsonrpc":"2.0","id":-0.5,"error":{"code":9007199254740992,"message":"broken"}}"#,
    ] {
        assert!(matches!(
            parse_message(&line.encode_utf16().collect::<Vec<_>>()),
            ParsedMessage::Response(_)
        ));
    }
    assert!(matches!(
        parse_message(
            &r#"{"jsonrpc":"2.0","method":"notify","params":[1]}"#
                .encode_utf16()
                .collect::<Vec<_>>()
        ),
        ParsedMessage::Notification(_)
    ));
}

#[test]
fn malformed_responses_retain_valid_ids_and_parse_errors_have_null_ids() {
    let ParsedMessage::Invalid { id, code, .. } = parse_message(
        &r#"{"jsonrpc":"2.0","id":7,"result":null,"error":{}}"#
            .encode_utf16()
            .collect::<Vec<_>>(),
    ) else {
        panic!("invalid response expected");
    };
    assert_eq!(id, Value::Number(7.0));
    assert_eq!(code, -32600);
    let ParsedMessage::Invalid { id, code, .. } = parse_message(&[123]) else {
        panic!("parse error expected");
    };
    assert_eq!(id, Value::Null);
    assert_eq!(code, -32700);
}
