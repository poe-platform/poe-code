//! Independent ACP protocol, state and streaming policies.
pub mod client;
pub mod layer;
pub mod protocol;
pub mod report;
pub mod stream;
pub mod transport;
pub mod updates;
use mcp_protocol_rust::json::Value;
pub(crate) fn s(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
pub(crate) fn o(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    )
}
pub(crate) fn text(value: &Value) -> String {
    if let Value::String(s) = value {
        String::from_utf16_lossy(s)
    } else {
        String::new()
    }
}
pub(crate) fn array(value: &Value) -> &[Value] {
    if let Value::Array(a) = value { a } else { &[] }
}
