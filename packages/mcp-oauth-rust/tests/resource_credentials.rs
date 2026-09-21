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
#[test]
fn explicit_imports_own_the_grant_client_and_registration_with_a_replay_tombstone() {
    let source=br#"{"resource":"https://resource.example/mcp","authorizationServer":"https://auth.example","client":{"clientId":"c","registration":{"client_id":"c"}},"tokens":{"accessToken":"token","tokenType":"Bearer","expiresAt":null},"discovery":{"resourceMetadataUrl":"https://resource.example/meta","resourceMetadata":{"resource":"https://resource.example/mcp"},"authorizationServerMetadata":{"issuer":"https://auth.example"}}}"#;
    let value = json::parse(source, Default::default()).unwrap();
    let mut imported = ResourceCredentials::import_session(value.clone()).unwrap();
    assert!(!imported.initial_grant_allowed());
    assert_eq!(
        imported
            .client(&resource("https://auth.example"))
            .get("registrationOwnership"),
        Some(&Value::String(resource("caller")))
    );
    imported
        .canonicalize_import(resource("https://resource.example/mcp"))
        .unwrap();
    assert_ne!(
        imported.session(&resource("https://resource.example/mcp")),
        Value::Null
    );
    assert_eq!(
        imported.import_bindings().unwrap().get("accessToken"),
        Some(&Value::String(resource("token")))
    );
    let serialized = imported.serialize().unwrap();
    assert!(ResourceCredentials::read(Some(serialized.as_bytes())).is_ok());
    let contradictory = String::from_utf8(source.to_vec()).unwrap().replace(
        r#""issuer":"https://auth.example""#,
        r#""issuer":"https://another.example""#,
    );
    assert!(
        ResourceCredentials::import_session(
            json::parse(contradictory.as_bytes(), Default::default()).unwrap()
        )
        .is_err()
    );
}
