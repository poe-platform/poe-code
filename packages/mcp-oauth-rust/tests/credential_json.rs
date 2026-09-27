use mcp_oauth_rust::registration::validate_credential_json;
use mcp_protocol_rust::json::Value;
#[test]
fn credential_json_accepts_uncapped_valid_extensions() {
    assert!(validate_credential_json(&Value::Null).is_ok());
    assert!(validate_credential_json(&Value::String(vec![97; 65_536])).is_ok());
    assert!(validate_credential_json(&Value::Array(vec![Value::Null; 20_000])).is_ok());
    let mut value = Value::Null;
    for _ in 0..65 {
        value = Value::Array(vec![value]);
    }
    assert!(validate_credential_json(&value).is_ok());
}
