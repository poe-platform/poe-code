use mcp_oauth_rust::session::{read_stored_client, validate_session};
use mcp_protocol_rust::json::{self, Limits, Value};
fn value(text: &str) -> Value {
    json::parse_utf16(&text.encode_utf16().collect::<Vec<_>>(), Limits::default()).unwrap()
}
#[test]
fn sessions_require_owned_nonblank_fields_and_valid_token_dates() {
    let base = r#"{"resource":"r","authorizationServer":"a","client":{"clientId":"c"},"discovery":{"resourceMetadataUrl":"u","resourceMetadata":{},"authorizationServerMetadata":{}}}"#;
    assert!(validate_session(&value(base)));
    let mut invalid = value(base);
    let Value::Object(fields) = &mut invalid else {
        panic!()
    };
    fields.push((
        "tokens".encode_utf16().collect(),
        value(r#"{"accessToken":"t","tokenType":"Bearer","expiresAt":8640000000000001}"#),
    ));
    assert!(!validate_session(&invalid));
    assert!(!validate_session(&value("{}")));
}
#[test]
fn client_storage_preserves_own_secret_json_value_and_accepts_empty_client_id() {
    let client = read_stored_client(&value(
        r#"{"clientId":"","clientSecret":null,"extra":true}"#,
    ))
    .unwrap();
    assert_eq!(client.get("clientSecret"), Some(&Value::Null));
    assert_eq!(client.get("extra"), Some(&Value::Bool(true)));
    assert!(read_stored_client(&value("{}")).is_err());
}
