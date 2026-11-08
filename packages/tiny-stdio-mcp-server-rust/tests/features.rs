use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_stdio_mcp_server_rust::{
    Action, Server, ServerOptions, Session,
    features::{FeatureKind, RegistrationKind, validate_result},
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
fn feature_registries_preserve_snapshots_order_duplicates_and_removal() {
    let mut server = server();
    for name in ["b", "a"] {
        server
            .features
            .register(
                RegistrationKind::Prompt,
                value(&format!(r#"{{"name":"{name}"}}"#)),
                1,
            )
            .unwrap();
    }
    assert!(
        server
            .features
            .register(RegistrationKind::Prompt, value(r#"{"name":"b"}"#), 2)
            .is_err()
    );
    let mut session = Session::default();
    server.dispatch(&mut session, "initialize", None);
    assert_eq!(
        server.dispatch(&mut session, "prompts/list", None),
        Action::Reply(value(r#"{"prompts":[{"name":"b"},{"name":"a"}]}"#))
    );
    assert_eq!(
        server.features.remove(
            RegistrationKind::Prompt,
            &"b".encode_utf16().collect::<Vec<_>>()
        ),
        Some(1)
    );
    assert_eq!(
        server.dispatch(&mut session, "prompts/list", None),
        Action::Reply(value(r#"{"prompts":[{"name":"a"}]}"#))
    );
}

#[test]
fn readable_resources_prefer_exact_uris_and_then_first_matching_template() {
    let mut server = server();
    server
        .features
        .register(
            RegistrationKind::ResourceTemplate,
            value(r#"{"uriTemplate":"memo://{name}","name":"first"}"#),
            1,
        )
        .unwrap();
    server
        .features
        .register(
            RegistrationKind::ResourceTemplate,
            value(r#"{"uriTemplate":"memo://{+path}","name":"second"}"#),
            2,
        )
        .unwrap();
    server
        .features
        .register(
            RegistrationKind::Resource,
            value(r#"{"uri":"memo://welcome","name":"exact"}"#),
            3,
        )
        .unwrap();
    let mut session = Session::default();
    server.dispatch(&mut session, "initialize", None);
    for (uri, handler) in [("memo://welcome", 3), ("memo://other", 1)] {
        let action = server.dispatch(
            &mut session,
            "resources/read",
            Some(value(&format!(r#"{{"uri":"{uri}"}}"#))),
        );
        assert_eq!(
            action,
            Action::InvokeFeature {
                handler,
                arguments: Some(Value::String(uri.encode_utf16().collect())),
                context: value(r#"{"clientCapabilities":{}}"#),
                kind: FeatureKind::Resource
            }
        );
    }
}

#[test]
fn prompt_arguments_and_negotiated_link_validation_are_isolated_by_session() {
    let mut server = server();
    server
        .features
        .register(
            RegistrationKind::Prompt,
            value(r#"{"name":"review","arguments":[{"name":"code","required":true}]}"#),
            1,
        )
        .unwrap();
    let mut older = Session::default();
    let mut newer = Session::default();
    server.dispatch(
        &mut older,
        "initialize",
        Some(value(r#"{"protocolVersion":"2025-03-26"}"#)),
    );
    server.dispatch(&mut newer, "initialize", None);
    assert!(matches!(
        server.dispatch(
            &mut newer,
            "prompts/get",
            Some(value(r#"{"name":"review"}"#))
        ),
        Action::Error(_)
    ));
    for (session, allow_resource_links) in [(&mut older, false), (&mut newer, true)] {
        assert!(
            matches!(server.dispatch(session, "prompts/get", Some(value(r#"{"name":"review","arguments":{"code":"main.rs"}}"#))), Action::InvokeFeature { kind: FeatureKind::Prompt { allow_resource_links: actual }, .. } if actual == allow_resource_links)
        );
    }
    let links = value(
        r#"{"messages":[{"role":"user","content":{"type":"resource_link","uri":"file:///document","name":"document"}}]}"#,
    );
    assert!(
        validate_result(
            FeatureKind::Prompt {
                allow_resource_links: false
            },
            Some(links.clone())
        )
        .is_err()
    );
    assert_eq!(
        validate_result(
            FeatureKind::Prompt {
                allow_resource_links: true
            },
            Some(links.clone())
        )
        .unwrap(),
        Some(links)
    );
}
