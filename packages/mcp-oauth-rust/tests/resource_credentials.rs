use mcp_oauth_rust::resource_credentials::ResourceCredentials;
use mcp_protocol_rust::json::{self, Value};
fn resource(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn identity_history_retires_credentials_on_url_changes_and_blocks_replay() {
    let mut record = ResourceCredentials::empty();
    assert!(
        record
            .reconcile(&resource("https://one.example/mcp"))
            .unwrap()
    );
    assert!(record.initial_grant_allowed());
    record
        .set_client(
            resource("https://auth.example"),
            json::parse(br#"{"clientId":"old"}"#, Default::default()).unwrap(),
        )
        .unwrap();
    assert!(
        !record
            .reconcile(&resource("https://one.example/mcp"))
            .unwrap()
    );
    assert_ne!(
        record.client(&resource("https://auth.example")),
        Value::Null
    );
    assert!(
        record
            .reconcile(&resource("https://two.example/mcp"))
            .unwrap()
    );
    assert_eq!(
        record.client(&resource("https://auth.example")),
        Value::Null
    );
    assert!(!record.initial_grant_allowed());
    record
        .reconcile(&resource("https://one.example/mcp"))
        .unwrap();
    assert!(!record.initial_grant_allowed());
    record.clear_session().unwrap();
    assert!(!record.initial_grant_allowed());
}
#[test]
fn documents_fail_closed_on_corruption_and_generation_overflow() {
    for source in [
        "not-json",
        "null",
        "{}",
        r#"{"version":1,"resource":"https://one.example/","generation":0,"session":null,"clients":{"https://auth.example":{}}}"#,
    ] {
        assert!(ResourceCredentials::read(Some(source.as_bytes())).is_err());
    }
    let source=br#"{"version":1,"resource":"https://one.example/","generation":9007199254740991,"session":null,"clients":{}}"#;
    let mut record = ResourceCredentials::read(Some(source)).unwrap();
    assert!(record.reconcile(&resource("https://two.example/")).is_err());
    assert_eq!(
        record.resource(),
        Some(resource("https://one.example/").as_slice())
    );
}
