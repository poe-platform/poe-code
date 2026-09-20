use mcp_protocol_rust::{
    json::{self, Limits, Value},
    jsonrpc::RpcError,
};
use tiny_stdio_mcp_server_rust::{Action, Server, ServerOptions, Session};

fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}
fn server() -> Server {
    Server::new(ServerOptions {
        name: "test".encode_utf16().collect(),
        version: "1.0".encode_utf16().collect(),
        support_notifications: false,
        support_resource_subscriptions: false,
        validate_tool_arguments: true,
    })
}
fn error(message: &str) -> Action {
    Action::Error(RpcError {
        code: -32602,
        message: message.into(),
        data: None,
    })
}
fn modern(capabilities: &str) -> Value {
    value(&format!(
        r#"{{"_meta":{{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{capabilities}}}}}"#
    ))
}

#[test]
fn custom_metadata_keys_must_follow_mcp_name_and_domain_grammar() {
    let server = server();
    for key in [
        "/name",
        "bad..domain/name",
        "1domain/name",
        "domain-/name",
        "domain/name/slash",
        "_bad",
        "bad_",
        "bad name",
        "é",
    ] {
        let params = value(&format!(r#"{{"_meta":{{"{key}":1}}}}"#));
        assert_eq!(
            server.dispatch(&mut Session::default(), "ping", Some(params)),
            error("Invalid MCP metadata keys"),
            "{key}"
        );
    }
    for key in [
        "",
        "name",
        "n_a.me",
        "example.com/name",
        "example.com/",
        "a-b.example.com/v1",
    ] {
        let params = value(&format!(r#"{{"_meta":{{"{key}":1}}}}"#));
        assert_eq!(
            server.dispatch(&mut Session::default(), "ping", Some(params)),
            Action::Reply(value("{}")),
            "{key}"
        );
    }
}

#[test]
fn metadata_must_be_finite_json_even_on_legacy_requests() {
    for metadata in [r#"{"progressToken":1e400}"#, r#"{"nested":{"x":[1e400]}}"#] {
        let params = value(&format!(r#"{{"_meta":{metadata}}}"#));
        assert_eq!(
            server().dispatch(&mut Session::default(), "ping", Some(params)),
            error("Invalid MCP metadata keys")
        );
    }
}

#[test]
fn modern_capabilities_validate_known_shapes_and_extension_names() {
    for capabilities in [
        r#"{"roots":1}"#,
        r#"{"sampling":false}"#,
        r#"{"elicitation":[]}"#,
        r#"{"sampling":{"tools":1}}"#,
        r#"{"sampling":{"context":null}}"#,
        r#"{"elicitation":{"form":false}}"#,
        r#"{"elicitation":{"url":[]}}"#,
        r#"{"extensions":{"unprefixed":{}}}"#,
        r#"{"extensions":{"example.com/name":1}}"#,
        r#"{"experimental":{"name":true}}"#,
    ] {
        assert_eq!(
            server().dispatch(
                &mut Session::default(),
                "tools/list",
                Some(modern(capabilities))
            ),
            error("Invalid MCP clientCapabilities"),
            "{capabilities}"
        );
    }
    for capabilities in [
        "{}",
        r#"{"roots":{},"sampling":{"tools":{},"context":{}},"elicitation":{"form":{},"url":{}}}"#,
        r#"{"extensions":{"example.com/name":{}},"experimental":{"name":{}}}"#,
        r#"{"future":42,"roots":{"future":true}}"#,
    ] {
        assert!(
            matches!(
                server().dispatch(
                    &mut Session::default(),
                    "tools/list",
                    Some(modern(capabilities))
                ),
                Action::Reply(_)
            ),
            "{capabilities}"
        );
    }
}

#[test]
fn register_tool_rejects_duplicates_without_replacing_the_existing_handler() {
    let mut server = server();
    let mut session = Session::default();
    let definition = value(r#"{"name":"echo","inputSchema":{"type":"object"}}"#);
    server.set_tool(definition.clone(), 1, false).unwrap();
    assert_eq!(
        server.set_tool(definition, 2, false).unwrap_err(),
        "Tool already registered: echo"
    );
    server.dispatch(&mut session, "initialize", None);
    assert_eq!(
        server.dispatch(
            &mut session,
            "tools/call",
            Some(value(r#"{"name":"echo"}"#))
        ),
        Action::Invoke {
            handler: 1,
            name: "echo".encode_utf16().collect(),
            arguments: value("{}"),
            context: value(r#"{"clientCapabilities":{}}"#)
        }
    );
}
