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
        support_notifications: true,
        support_resource_subscriptions: true,
    })
}
fn error(code: i32, message: &str) -> Action {
    Action::Error(RpcError {
        code,
        message: message.into(),
        data: None,
    })
}

#[test]
fn ping_does_not_initialize_the_session() {
    let server = server();
    let mut session = Session::default();
    assert_eq!(
        server.dispatch(&mut session, "ping", None),
        Action::Reply(value("{}"))
    );
    assert_eq!(
        server.dispatch(&mut session, "tools/list", None),
        error(-32600, "Server not initialized")
    );
}

#[test]
fn legacy_initialize_preserves_negotiation_and_public_capabilities() {
    let server = server();
    let mut session = Session::default();
    let result = server.dispatch(
        &mut session,
        "initialize",
        Some(value(r#"{"protocolVersion":"2025-03-26"}"#)),
    );
    assert_eq!(
        result,
        Action::Reply(value(
            r#"{"protocolVersion":"2025-03-26","capabilities":{"tools":{"listChanged":true},"prompts":{"listChanged":true},"resources":{"listChanged":true,"subscribe":true}},"serverInfo":{"name":"test","version":"1.0"}}"#
        ))
    );
    assert_eq!(session.protocol_version(), "2025-03-26");
    assert!(!session.notifications_ready());
    assert_eq!(
        server.dispatch(&mut session, "tools/list", None),
        Action::Reply(value(r#"{"tools":[]}"#))
    );
    assert_eq!(
        server.dispatch(&mut session, "notifications/initialized", None),
        Action::NoReply
    );
    assert!(session.notifications_ready());
}

#[test]
fn reinitialization_is_idempotent_but_resets_notification_readiness() {
    let server = server();
    let mut session = Session::default();
    server.dispatch(&mut session, "initialize", None);
    server.dispatch(&mut session, "notifications/initialized", None);
    assert!(matches!(
        server.dispatch(&mut session, "initialize", None),
        Action::Reply(_)
    ));
    assert!(!session.notifications_ready());
}

#[test]
fn unsupported_and_modern_initialize_parameters_fall_back_to_the_legacy_version() {
    let server = server();
    for version in ["future", "2026-07-28"] {
        let mut session = Session::default();
        let params = value(&format!(r#"{{"protocolVersion":"{version}"}}"#));
        let Action::Reply(result) = server.dispatch(&mut session, "initialize", Some(params))
        else {
            panic!("initialize reply")
        };
        assert_eq!(
            result.get("protocolVersion"),
            Some(&value(r#""2025-11-25""#))
        );
    }
}

#[test]
fn sessions_are_independent_and_closed_sessions_cannot_be_reopened() {
    let server = server();
    let mut initialized = Session::default();
    let mut fresh = Session::default();
    server.dispatch(&mut initialized, "initialize", None);
    assert_eq!(
        server.dispatch(&mut fresh, "tools/list", None),
        error(-32600, "Server not initialized")
    );
    initialized.close();
    initialized.close();
    assert_eq!(
        server.dispatch(&mut initialized, "initialize", None),
        Action::NoReply
    );
    assert_eq!(
        server.dispatch(&mut initialized, "ping", None),
        Action::NoReply
    );
}

#[test]
fn initialized_notification_without_initialize_fails() {
    assert_eq!(
        server().dispatch(&mut Session::default(), "notifications/initialized", None),
        error(-32600, "Server not initialized")
    );
}

#[test]
fn modern_discovery_is_stateless_and_decorates_server_metadata() {
    let server = server();
    let mut session = Session::default();
    let params = value(
        r#"{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}"#,
    );
    let Action::Reply(result) =
        server.dispatch(&mut session, "server/discover", Some(params.clone()))
    else {
        panic!("discover result")
    };
    assert_eq!(
        result.get("supportedVersions"),
        Some(&value(
            r#"["2026-07-28","2025-11-25","2025-06-18","2025-03-26"]"#
        ))
    );
    assert_eq!(result.get("resultType"), Some(&value(r#""complete""#)));
    assert_eq!(result.get("ttlMs"), Some(&value("0")));
    assert_eq!(result.get("cacheScope"), Some(&value(r#""private""#)));
    assert_eq!(
        result.get("_meta"),
        Some(&value(
            r#"{"io.modelcontextprotocol/serverInfo":{"name":"test","version":"1.0"}}"#
        ))
    );
    assert!(!session.notifications_ready());
    assert_eq!(
        server.dispatch(&mut session, "ping", Some(params)),
        error(-32601, "Method not found")
    );
    assert_eq!(
        server.dispatch(&mut session, "tools/list", None),
        error(-32600, "Server not initialized")
    );
}

#[test]
fn discovery_requires_explicit_request_metadata() {
    assert_eq!(
        server().dispatch(&mut Session::default(), "server/discover", None),
        error(
            -32602,
            "Request metadata must include protocolVersion and clientCapabilities"
        )
    );
}

#[test]
fn capabilities_are_derived_from_server_options() {
    let server = Server::new(ServerOptions {
        name: "silent".encode_utf16().collect(),
        version: "0".encode_utf16().collect(),
        support_notifications: false,
        support_resource_subscriptions: false,
    });
    let Action::Reply(result) = server.dispatch(&mut Session::default(), "initialize", None) else {
        panic!("initialize")
    };
    assert_eq!(
        result.get("capabilities"),
        Some(&value(r#"{"tools":{},"prompts":{},"resources":{}}"#))
    );
}

#[test]
fn tools_are_listed_in_registration_order_and_replacement_keeps_position() {
    let mut server = server();
    let mut session = Session::default();
    server.dispatch(&mut session, "initialize", None);
    for (name, handler) in [("b", 1), ("a", 2), ("b", 3)] {
        server
            .set_tool(
                value(&format!(
                    r#"{{"name":"{name}","description":"echo","inputSchema":{{"type":"object"}}}}"#
                )),
                handler,
                true,
            )
            .unwrap();
    }
    assert_eq!(
        server.dispatch(&mut session, "tools/list", None),
        Action::Reply(value(
            r#"{"tools":[{"name":"b","description":"echo","inputSchema":{"type":"object"}},{"name":"a","description":"echo","inputSchema":{"type":"object"}}]}"#
        ))
    );
    assert_eq!(
        server.dispatch(&mut session, "tools/call", Some(value(r#"{"name":"b"}"#))),
        Action::Invoke {
            handler: 3,
            arguments: value("{}"),
            context: value(r#"{"clientCapabilities":{}}"#)
        }
    );
    assert!(server.remove_tool(&[b'b' as u16]));
    assert!(!server.remove_tool(&[b'b' as u16]));
}

#[test]
fn tool_dispatch_validates_name_arguments_and_available_tool_diagnostics() {
    let mut server = server();
    let mut session = Session::default();
    server.dispatch(&mut session, "initialize", None);
    server
        .set_tool(
            value(r#"{"name":"echo","inputSchema":{"type":"object"}}"#),
            1,
            false,
        )
        .unwrap();
    assert_eq!(
        server.dispatch(&mut session, "tools/call", None),
        error(-32602, "Tool name required")
    );
    assert_eq!(
        server.dispatch(
            &mut session,
            "tools/call",
            Some(value(r#"{"name":"missing"}"#))
        ),
        error(-32602, "Tool not found: missing. Available: echo")
    );
    for arguments in ["[]", "null", "1", "false"] {
        let params = value(&format!(r#"{{"name":"echo","arguments":{arguments}}}"#));
        assert_eq!(
            server.dispatch(&mut session, "tools/call", Some(params)),
            error(-32602, "Tool arguments must be an object")
        );
    }
}

#[test]
fn legacy_list_hides_non_object_output_schemas_and_keeps_modern_schemas() {
    let mut server = server();
    let mut session = Session::default();
    server.set_tool(value(r#"{"name":"scalar","inputSchema":{"type":"object"},"outputSchema":{"type":"string"}}"#), 1, false).unwrap();
    server.dispatch(&mut session, "initialize", None);
    assert_eq!(
        server.dispatch(&mut session, "tools/list", None),
        Action::Reply(value(
            r#"{"tools":[{"name":"scalar","inputSchema":{"type":"object"}}]}"#
        ))
    );
    let Action::Reply(result) = server.dispatch(&mut Session::default(), "tools/list", Some(value(r#"{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}"#))) else { panic!("modern list") };
    assert_eq!(
        result.get("tools"),
        Some(&value(
            r#"[{"name":"scalar","inputSchema":{"type":"object"},"outputSchema":{"type":"string"}}]"#
        ))
    );
}
