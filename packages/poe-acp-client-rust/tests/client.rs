use mcp_protocol_rust::json::{self, Value};
use poe_acp_client_rust::client::Client;
fn v(source: &str) -> Value {
    json::parse_utf16(
        &source.encode_utf16().collect::<Vec<_>>(),
        Default::default(),
    )
    .unwrap()
}
#[test]
fn negotiation_authentication_and_prompt_admission_are_owned() {
    let mut client = Client::new(2.0, false);
    client.begin_initialize().unwrap();
    assert!(client.begin_initialize().is_err());
    client
        .finish_initialize(&v(
            r#"{"protocolVersion":1,"authMethods":[{"id":"key","name":"Key"}]}"#,
        ))
        .unwrap();
    assert_eq!(client.state(), "initialized");
    assert!(client.ready("session/new").is_err());
    client.begin_authenticate("key").unwrap();
    assert!(client.begin_authenticate("key").is_err());
    client.end_authenticate(true);
    assert_eq!(client.state(), "ready");
    let session = "s".encode_utf16().collect::<Vec<_>>();
    client.begin_prompt(&session, &v("[]")).unwrap();
    assert!(client.begin_prompt(&session, &v("[]")).is_err());
    client.end_prompt(&session);
    client.dispose();
    assert!(client.ready("session/new").is_err());
}
#[test]
fn malformed_handshake_releases_initialization_for_retry() {
    let mut client = Client::new(1.0, false);
    client.begin_initialize().unwrap();
    assert!(
        client
            .finish_initialize(&v(r#"{"protocolVersion":null}"#))
            .is_err()
    );
    client.end_initialize();
    client.begin_initialize().unwrap();
    client
        .finish_initialize(&v(r#"{"protocolVersion":1}"#))
        .unwrap();
    assert!(client.mcp(&v(r#"[{"type":"http"}]"#)).is_err());
    assert!(
        client
            .begin_prompt(&[], &v(r#"[{"type":"image"}]"#))
            .is_err()
    );
    assert!(Client::new(-1.0, false).begin_initialize().is_err());
}
#[test]
fn completed_queue_refuses_payload_tokens_and_drains_before_failure() {
    use poe_acp_client_rust::client::Queue;
    let mut queue = Queue::default();
    assert!(queue.push(v("1")));
    queue.complete();
    assert!(!queue.push(v("2")));
    assert_eq!(queue.poll().get("value"), Some(&v("1")));
    assert_eq!(queue.poll().get("type"), Some(&v(r#""done""#)));
    let mut queue = Queue::default();
    assert!(queue.push(v("3")));
    queue.fail("failed".into());
    assert!(!queue.push(v("4")));
    assert_eq!(queue.poll().get("value"), Some(&v("3")));
    assert_eq!(queue.poll().get("message"), Some(&v(r#""failed""#)));
}
