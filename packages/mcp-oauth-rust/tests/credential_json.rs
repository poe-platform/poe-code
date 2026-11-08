use mcp_oauth_rust::registration::validate_credential_json;
use mcp_protocol_rust::json::Value;
#[test]
fn credential_json_accepts_large_and_deep_finite_values() {
    assert!(validate_credential_json(&Value::Null).is_ok());
    assert!(validate_credential_json(&Value::String(vec![97; 65_536])).is_ok());
    assert!(validate_credential_json(&Value::Array(vec![Value::Null; 20_000])).is_ok());
    assert!(validate_credential_json(&Value::Array(vec![Value::Null; 20_001])).is_ok());
    let mut value = Value::Null;
    for _ in 0..2048 {
        value = Value::Array(vec![value]);
    }
    let result = validate_credential_json(&value);
    while let Value::Array(mut values) = value {
        value = values.pop().unwrap();
    }
    assert!(result.is_ok());
}
#[test]
fn credential_json_rejects_nonfinite_numbers_at_any_depth() {
    for number in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(validate_credential_json(&Value::Array(vec![Value::Number(number)])).is_err());
    }
}
