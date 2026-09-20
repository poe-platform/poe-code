use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_stdio_mcp_server_rust::notifications::NotificationKind;
use tiny_stdio_mcp_server_rust::{
    Action, Server, ServerOptions, Session, features::RegistrationKind,
};

fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}
fn server() -> Server {
    let mut server = Server::new(ServerOptions {
        name: "test".encode_utf16().collect(),
        version: "0".encode_utf16().collect(),
        support_notifications: true,
        support_resource_subscriptions: true,
        validate_tool_arguments: true,
    });
    server
        .features
        .register(
            RegistrationKind::ResourceTemplate,
            value(r#"{"uriTemplate":"memo://{name}","name":"memo"}"#),
            1,
        )
        .unwrap();
    server
}

#[test]
fn resource_subscriptions_validate_readability_and_preserve_lifecycle() {
    let server = server();
    let mut session = Session::default();
    server.dispatch(&mut session, "initialize", None);
    for method in ["resources/subscribe", "resources/unsubscribe"] {
        assert!(
            matches!(server.dispatch(&mut session, method, Some(value(r#"{"uri":"relative"}"#))), Action::Error(error) if error.code == -32602)
        );
    }
    assert!(
        matches!(server.dispatch(&mut session, "resources/subscribe", Some(value(r#"{"uri":"missing://welcome"}"#))), Action::Error(error) if error.code == -32002)
    );
    assert_eq!(
        server.dispatch(
            &mut session,
            "resources/subscribe",
            Some(value(r#"{"uri":"memo://welcome"}"#))
        ),
        Action::Reply(value("{}"))
    );
    assert_eq!(
        server.dispatch(
            &mut session,
            "resources/unsubscribe",
            Some(value(r#"{"uri":"missing://welcome"}"#))
        ),
        Action::Reply(value("{}"))
    );
}

#[test]
fn notification_plans_filter_subscriptions_readiness_and_closed_sessions() {
    let server = server();
    let mut first = Session::default();
    let mut second = Session::default();
    let uri: Vec<u16> = "memo://welcome".encode_utf16().collect();
    assert!(
        server
            .notification(NotificationKind::ToolsChanged, [(1, &first)])
            .is_none()
    );
    assert!(
        server
            .notification(
                NotificationKind::ResourceUpdated(uri.clone()),
                [(1, &first)]
            )
            .unwrap()
            .sessions
            .is_empty()
    );
    for session in [&mut first, &mut second] {
        server.dispatch(session, "initialize", None);
        server.dispatch(session, "notifications/initialized", None);
    }
    server.dispatch(
        &mut first,
        "resources/subscribe",
        Some(value(r#"{"uri":"memo://welcome"}"#)),
    );
    let plan = server
        .notification(
            NotificationKind::ResourceUpdated(uri.clone()),
            [(2, &second), (1, &first)],
        )
        .unwrap();
    assert_eq!(plan.sessions, [1]);
    assert_eq!(
        plan.value,
        value(
            r#"{"jsonrpc":"2.0","method":"notifications/resources/updated","params":{"uri":"memo://welcome"}}"#
        )
    );
    server.dispatch(&mut first, "initialize", None);
    assert!(
        server
            .notification(
                NotificationKind::ResourceUpdated(uri.clone()),
                [(1, &first)]
            )
            .unwrap()
            .sessions
            .is_empty()
    );
    server.dispatch(&mut first, "notifications/initialized", None);
    assert_eq!(
        server
            .notification(
                NotificationKind::ResourceUpdated(uri.clone()),
                [(1, &first)]
            )
            .unwrap()
            .sessions,
        [1]
    );
    assert_eq!(
        server
            .notification(
                NotificationKind::PromptsChanged,
                [(2, &second), (1, &first)]
            )
            .unwrap()
            .sessions,
        [1, 2]
    );
    first.close();
    assert!(!first.can_notify(true));
    assert_eq!(
        server
            .notification(
                NotificationKind::ResourcesChanged,
                [(2, &second), (1, &first)]
            )
            .unwrap()
            .sessions,
        [2]
    );
    second.close();
    assert!(
        server
            .notification(NotificationKind::ToolsChanged, [(2, &second), (1, &first)])
            .is_none()
    );
}
