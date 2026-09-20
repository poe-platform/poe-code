use mcp_protocol_rust::{json::Value, metadata::is_valid_metadata};

fn object(value: Value) -> Value {
    Value::Object(vec![("value".encode_utf16().collect(), value)])
}

#[test]
fn metadata_rejects_nonfinite_numbers_and_enforces_json_node_budget() {
    assert!(!is_valid_metadata(&object(Value::Number(f64::INFINITY))));
    assert!(is_valid_metadata(&object(Value::Array(vec![
        Value::Null;
        9_998
    ]))));
    assert!(!is_valid_metadata(&object(Value::Array(vec![
        Value::Null;
        9_999
    ]))));
}

#[test]
fn metadata_accepts_depth_64_and_rejects_depth_65() {
    let mut metadata = Value::Null;
    for _ in 0..64 {
        metadata = object(metadata);
    }
    assert!(is_valid_metadata(&metadata));
    assert!(!is_valid_metadata(&object(metadata)));
}
