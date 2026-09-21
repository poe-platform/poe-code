use mcp_protocol_rust::json::{self, Value};
use poe_acp_client_rust::{protocol, updates};
fn v(source: &str) -> Value {
    json::parse_utf16(
        &source.encode_utf16().collect::<Vec<_>>(),
        Default::default(),
    )
    .unwrap()
}
#[test]
fn rpc_ids_and_faults_preserve_acp_dialect() {
    for id in ["null", "0", "\"x\""] {
        let parsed = protocol::parse(
            &format!(r#"{{"jsonrpc":"2.0","id":{id},"method":"echo","params":3}}"#)
                .encode_utf16()
                .collect::<Vec<_>>(),
        );
        assert_eq!(parsed.get("type"), Some(&v("\"request\"")));
    }
    let malformed = protocol::parse(&"{bad".encode_utf16().collect::<Vec<_>>());
    assert_eq!(
        malformed.get("error").unwrap().get("code"),
        Some(&v("-32700"))
    );
    for source in [
        r#"{"jsonrpc":"2.0","id":1.5,"method":"echo"}"#,
        r#"{"jsonrpc":"2.0","id":0,"result":1,"error":{"code":-1,"message":"bad"}}"#,
        r#"{"jsonrpc":"2.0","id":0,"error":{"code":2147483648,"message":"bad"}}"#,
    ] {
        assert_eq!(
            protocol::parse(&source.encode_utf16().collect::<Vec<_>>()).get("type"),
            Some(&v("\"invalid\""))
        );
    }
}
#[test]
fn update_shapes_cover_optional_nulls_and_locations() {
    for source in [
        r#"{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello","annotations":null}}}"#,
        r#"{"sessionId":"s","update":{"sessionUpdate":"tool_call_update","toolCallId":"t","kind":null,"status":null,"content":null}}"#,
        r#"{"sessionId":"s","update":{"sessionUpdate":"plan","entries":[]}}"#,
    ] {
        assert!(updates::notification(&v(source)));
    }
    for source in [
        r#"{"sessionId":"s","update":{"sessionUpdate":"tool_call","toolCallId":"t","title":"Read","locations":[{"path":"/file","line":1}]}}"#,
        r#"{"sessionId":"s","update":{"sessionUpdate":"plan","entries":[{"content":"x","priority":"urgent","status":"pending"}]}}"#,
    ] {
        assert!(!updates::notification(&v(source)));
    }
}
