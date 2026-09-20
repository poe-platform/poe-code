use mcp_protocol_rust::{
    json::{self, Limits, Value},
    jsonrpc::RpcError,
};
use tiny_stdio_mcp_server_rust::{Server, ServerOptions, tool_result::ResultError};

fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}
fn server() -> Server {
    Server::new(ServerOptions {
        name: "test".encode_utf16().collect(),
        version: "0".encode_utf16().collect(),
        support_notifications: true,
        support_resource_subscriptions: true,
        validate_tool_arguments: true,
    })
}

#[test]
fn object_outputs_gain_structured_content_and_schema_errors_carry_issues() {
    let mut server = server();
    server.set_tool(value(r#"{"name":"check","inputSchema":{"type":"object"},"outputSchema":{"type":"object","properties":{"value":{"type":"integer"}},"required":["value"]}}"#), 1, false).unwrap();
    let output = server.output_contract(1).unwrap();
    assert_eq!(
        output
            .normalize(Some(value(r#"{"value":1}"#)), false)
            .unwrap(),
        value(
            r#"{"content":[{"type":"text","text":"{\"value\":1}"}],"structuredContent":{"value":1}}"#
        )
    );
    let Err(ResultError::Rpc(RpcError {
        code,
        data: Some(Value::Array(issues)),
        ..
    })) = output.normalize(Some(value("{}")), true)
    else {
        panic!("schema failure must be a structured RPC error");
    };
    assert_eq!(code, -32603);
    assert_eq!(issues[0].get("keyword"), Some(&value(r#""required""#)));
    assert_eq!(
        output
            .normalize(
                Some(value(
                    r#"{"content":[{"type":"text","text":"failure"}],"isError":true}"#
                )),
                false
            )
            .unwrap()
            .get("isError"),
        Some(&Value::Bool(true))
    );
}

#[test]
fn legacy_scalar_schemas_hide_structured_content_and_skip_validation() {
    let mut server = server();
    server.set_tool(value(r#"{"name":"check","inputSchema":{"type":"object"},"outputSchema":{"type":"string","pattern":"^a+$"}}"#), 1, false).unwrap();
    let output = server.output_contract(1).unwrap();
    assert_eq!(
        output.normalize(Some(value(r#""bad""#)), false).unwrap(),
        value(r#"{"content":[{"type":"text","text":"bad"}]}"#)
    );
    assert!(matches!(
        output.normalize(Some(value(r#""bad""#)), true),
        Err(ResultError::Rpc(_))
    ));
}

#[test]
fn output_contract_survives_removal_and_invalid_output_grammar_is_atomic() {
    let mut server = server();
    server.set_tool(value(r#"{"name":"check","inputSchema":{"type":"object"},"outputSchema":{"type":"object","required":["original"]}}"#), 1, false).unwrap();
    let output = server.output_contract(1).unwrap();
    assert!(
        server
            .set_tool(
                value(r#"{"name":"check","inputSchema":{"type":"object"},"outputSchema":false}"#),
                2,
                true
            )
            .is_err()
    );
    assert!(server.output_contract(1).is_some());
    assert!(server.output_contract(2).is_none());
    server.remove_tool(&"check".encode_utf16().collect::<Vec<_>>());
    assert!(server.output_contract(1).is_none());
    assert!(matches!(
        output.normalize(Some(value("{}")), true),
        Err(ResultError::Rpc(_))
    ));
}
