use mcp_protocol_rust::{
    json::{self, Limits, Value},
    jsonrpc::Id,
};
use tiny_stdio_mcp_server_rust::{
    Action, Server, ServerOptions, Session, notifications::NotificationKind,
};

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
fn listens_validate_filters_before_registering_and_require_an_id() {
    let server = server();
    let mut session = Session::default();
    for (id, filter) in [
        (None, Some(value("{}"))),
        (Some(Id::Number(1.0)), None),
        (
            Some(Id::Number(1.0)),
            Some(value(r#"{"toolsListChanged":1}"#)),
        ),
        (
            Some(Id::Number(1.0)),
            Some(value(r#"{"resourceSubscriptions":["relative"]}"#)),
        ),
    ] {
        assert!(
            matches!(server.listen(&mut session, 1, id, filter), Action::Error(error) if error.code == -32602)
        );
        assert_eq!(session.subscription_count(), 0);
    }
}

#[test]
fn listens_acknowledge_before_delivery_and_preserve_raw_utf16_ids() {
    let server = server();
    let mut session = Session::default();
    assert!(
        matches!(server.listen(&mut session, 2, Some(Id::String(vec![0xd800])), Some(value(r#"{"toolsListChanged":true,"resourceSubscriptions":["memo://item","memo://item"]}"#))), Action::Listen { acknowledgment } if acknowledgment.get("params").unwrap().get("_meta").unwrap().get("io.modelcontextprotocol/subscriptionId") == Some(&Value::String(vec![0xd800])))
    );
    assert_eq!(session.subscription_count(), 1);
    let plan = server
        .notification(NotificationKind::ToolsChanged, [(1, &session)])
        .unwrap();
    assert!(plan.subscriptions.is_empty());
    assert!(session.acknowledge_subscription(2));
    assert_eq!(
        server
            .notification(NotificationKind::ToolsChanged, [(1, &session)])
            .unwrap()
            .subscriptions
            .len(),
        1
    );
    assert_eq!(
        server
            .notification(
                NotificationKind::ResourceUpdated("memo://item".encode_utf16().collect()),
                [(1, &session)]
            )
            .unwrap()
            .subscriptions
            .len(),
        1
    );
    assert!(session.finish_subscription(2));
    assert_eq!(session.subscription_count(), 0);
    assert!(!session.acknowledge_subscription(2));
    assert!(
        server
            .notification(NotificationKind::ToolsChanged, [(1, &session)])
            .is_none()
    );
}
