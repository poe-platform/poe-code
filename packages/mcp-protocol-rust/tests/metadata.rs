use mcp_protocol_rust::{json::Value, metadata::is_valid_metadata};

fn object(value: Value) -> Value {
    Value::Object(vec![("value".encode_utf16().collect(), value)])
}

#[test]
fn metadata_validates_finite_numbers_without_a_node_budget() {
    assert!(is_valid_metadata(&object(Value::Array(vec![
        Value::Null;
        20_000
    ]))));
    for number in [f64::INFINITY, f64::NEG_INFINITY, f64::NAN] {
        assert!(!is_valid_metadata(&object(Value::Array(vec![
            Value::Number(number)
        ]))));
    }
}

#[test]
fn metadata_accepts_depth_above_64() {
    let mut metadata = Value::Null;
    for _ in 0..200 {
        metadata = object(metadata);
    }
    assert!(is_valid_metadata(&metadata));
}
