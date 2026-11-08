//! Session log validation and independent in-memory transcript ownership.
use mcp_protocol_rust::{
    json::{self, Value},
    strings::trim_ecmascript,
};
#[derive(Debug, PartialEq)]
pub enum LogError {
    Syntax(usize),
    Invalid,
    Limit(usize),
}
fn string(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::String(_)))
}
pub fn valid_entry(value: &Value) -> bool {
    if !string(value.get("id"))
        || !matches!(value.get("parentId"), Some(Value::Null | Value::String(_)))
        || !string(value.get("createdAt"))
    {
        return false;
    }
    let Some(Value::String(kind)) = value.get("kind") else {
        return false;
    };
    match String::from_utf16_lossy(kind).as_str() {
        "user" | "assistant" => string(value.get("text")),
        "tool_call" => string(value.get("tool")) && string(value.get("intentId")),
        "tool_result" => string(value.get("intentId")),
        "compaction" => {
            string(value.get("summary"))
                && ["droppedIds", "readFiles", "modifiedFiles"]
                    .iter()
                    .all(|key| matches!(value.get(key), Some(Value::Array(_))))
        }
        "branch_summary" => string(value.get("fromEntryId")) && string(value.get("summary")),
        "fork_marker" => string(value.get("fromEntryId")),
        _ => false,
    }
}
pub fn decode_jsonl(source: &[u16]) -> Result<Vec<Value>, LogError> {
    let mut entries = vec![];
    let trailing_partial = source.last() != Some(&10);
    let mut lines = source.split(|unit| *unit == 10).enumerate().peekable();
    while let Some((index, line)) = lines.next() {
        let line = trim_ecmascript(line);
        if line.is_empty() {
            continue;
        }
        let value = match json::parse_utf16(line, Default::default()) {
            Ok(value) => value,
            Err(error) => {
                if matches!(
                    error.kind,
                    json::ErrorKind::ByteLimit
                        | json::ErrorKind::DepthLimit
                        | json::ErrorKind::NodeLimit
                        | json::ErrorKind::InvalidLimits
                ) {
                    return Err(LogError::Limit(index + 1));
                }
                if trailing_partial && lines.peek().is_none() {
                    break;
                }
                return Err(LogError::Syntax(index + 1));
            }
        };
        if !valid_entry(&value) {
            return Err(LogError::Invalid);
        }
        entries.push(value);
    }
    Ok(entries)
}
#[derive(Default)]
pub struct MemoryStore {
    entries: Vec<Value>,
}
impl MemoryStore {
    pub fn append(&mut self, source: &[u16]) -> Result<(), json::Error> {
        self.entries
            .push(json::parse_utf16(source, Default::default())?);
        Ok(())
    }
    pub fn entries(&self) -> &[Value] {
        &self.entries
    }
    pub fn clear(&mut self) {
        self.entries = Vec::new();
    }
}
