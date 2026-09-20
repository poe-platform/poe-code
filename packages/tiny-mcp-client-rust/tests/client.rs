use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_mcp_client_rust::client::{ClientState, ConnectionState};
fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}

#[test]
fn connection_generations_isolate_reconnections_and_return_owned_snapshots() {
    let mut client = ClientState::default();
    assert_eq!(client.state(), ConnectionState::Disconnected);
    let generation = client.begin_connect().unwrap();
    assert!(client.begin_connect().is_err());
    client.accept_initialize(generation, value(r#"{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"server","version":"1"}}"#)).unwrap();
    assert_eq!(client.state(), ConnectionState::Ready);
    assert!(client.require_capability("tools").is_ok());
    assert!(client.require_capability("resources").is_err());
    client.close();
    let next = client.begin_connect().unwrap();
    assert!(!client.connection_closed(generation));
    assert_eq!(client.state(), ConnectionState::Initializing);
    assert!(client.connection_closed(next));
    assert_eq!(client.state(), ConnectionState::Closed);
}

#[test]
fn discovery_checks_versions_metadata_identity_and_cache_before_ready() {
    let mut client = ClientState::default();
    let generation = client.begin_connect().unwrap();
    let discovery = value(
        r#"{"resultType":"complete","supportedVersions":["2026-07-28"],"capabilities":{"tools":{}},"ttlMs":0,"cacheScope":"private","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"server","version":"1"}},"instructions":"hello"}"#,
    );
    client.accept_discovery(generation, discovery).unwrap();
    assert!(client.modern());
    assert_eq!(
        client.instructions(),
        Some("hello".encode_utf16().collect())
    );
    client.close();
    let generation = client.begin_connect().unwrap();
    let invalid = value(
        r#"{"resultType":"complete","supportedVersions":["old"],"capabilities":{},"ttlMs":0,"cacheScope":"private"}"#,
    );
    assert_eq!(
        client
            .accept_discovery(generation, invalid)
            .unwrap_err()
            .code,
        Some(-32022)
    );
    assert_eq!(client.state(), ConnectionState::Initializing);
}

#[test]
fn legacy_content_validation_retains_reference_acceptance_without_modern_annotation_rules() {
    let client = ClientState::default();
    assert!(
        client
            .validate_result(
                "tools/call",
                &value(r#"{"content":[{"type":"text","text":"ok","annotations":false}]}"#)
            )
            .is_ok()
    );
    assert!(
        client
            .validate_result(
                "tools/call",
                &value(r#"{"content":[],"structuredContent":null}"#)
            )
            .is_err()
    );
    assert!(
        client
            .validate_result(
                "resources/read",
                &value(r#"{"contents":[{"uri":"memo://item","text":"ok","blob":"bad!"}]}"#)
            )
            .is_err()
    );
    assert!(
        client
            .validate_result(
                "tools/list",
                &value(r#"{"tools":[{"name":"x","inputSchema":{"type":"object"}}]}"#)
            )
            .is_ok()
    );
}
