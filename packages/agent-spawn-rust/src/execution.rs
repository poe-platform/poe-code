//! Portable execution policies. Host adapters supply filesystem and process effects.
use crate::object;
use mcp_protocol_rust::json::Value;
pub fn merge_mcp(existing: &Value, addition: &Value) -> Result<Value, String> {
    let mut merged = object(existing)
        .ok_or("Existing MCP config JSON must contain an object.")?
        .to_vec();
    for (key, value) in object(addition).ok_or("MCP config additions must contain an object.")? {
        if let Some(index) = merged.iter().position(|(candidate, _)| candidate == key) {
            merged[index].1 = if object(&merged[index].1).is_some() && object(value).is_some() {
                merge_mcp(&merged[index].1, value)?
            } else {
                value.clone()
            };
        } else {
            merged.push((key.clone(), value.clone()));
        }
    }
    Ok(Value::Object(merged))
}
