//! Parse and normalize stored plain JSON in one owned operation.
use mcp_protocol_rust::json::{self, Value};
pub fn parse(text: &[u16]) -> Option<Value> {
    let value = json::parse_utf16(
        text,
        json::Limits {
            max_depth: 512,
            max_bytes: usize::MAX,
            max_nodes: usize::MAX,
        },
    )
    .ok()?;
    let Value::Object(scopes) = value else {
        return Some(Value::Object(vec![]));
    };
    Some(Value::Object(
        scopes
            .into_iter()
            .filter_map(|(key, value)| match value {
                Value::Object(fields) if !fields.is_empty() => Some((key, Value::Object(fields))),
                _ => None,
            })
            .collect(),
    ))
}
