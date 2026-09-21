use mcp_protocol_rust::json::{self, Value};
#[derive(Debug)]
pub enum ReadError {
    Syntax(json::Error),
    Unsupported(Option<Value>),
    Invalid,
}
fn string(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::String(_)))
}
fn part(value: &Value) -> bool {
    match value.get("type") {
        Some(Value::String(kind)) => match String::from_utf16_lossy(kind).as_str() {
            "text" => string(value.get("text")),
            "image" => string(value.get("mimeType")) && string(value.get("data")),
            "error" => {
                string(value.get("code"))
                    && string(value.get("message"))
                    && matches!(value.get("retriable"), Some(Value::Bool(_)))
            }
            _ => false,
        },
        _ => false,
    }
}
fn message(value: &Value) -> bool {
    if !matches!(value.get("role"),Some(Value::String(role))if ["system","user","assistant","tool"].iter().any(|expected|role==&expected.encode_utf16().collect::<Vec<_>>()))
    {
        return false;
    }
    match value.get("content") {
        Some(Value::String(_)) => true,
        Some(Value::Array(values)) => values.iter().all(part),
        _ => false,
    }
}
pub fn decode(source: &[u16]) -> Result<Value, ReadError> {
    let value = json::parse_utf16(source, Default::default()).map_err(ReadError::Syntax)?;
    let version = value.get("version");
    if version != Some(&Value::Number(1.0)) {
        return Err(ReadError::Unsupported(version.cloned()));
    }
    if !["threadId", "model", "cwd", "createdAt", "updatedAt"]
        .iter()
        .all(|key| string(value.get(key)))
        || !matches!(value.get("messages"),Some(Value::Array(values))if values.iter().all(message))
    {
        return Err(ReadError::Invalid);
    }
    Ok(value)
}
