//! Streaming JSONL framing shared by language-specific spawn-log readers.
use mcp_protocol_rust::json::{self, Limits, Value};
use mcp_protocol_rust::strings::trim_ecmascript;

#[derive(Debug, PartialEq, Eq)]
pub struct Record {
    pub line_number: u64,
    pub text: Vec<u16>,
}
#[derive(Debug, PartialEq)]
pub enum DecodedRecord {
    Updates(Vec<Value>),
    Unknown,
}
impl Record {
    /// Decode a portable JSON record using caller-selected parsing budgets.
    /// Host bindings may use their own JSON API to retain host diagnostics and
    /// prototype semantics; framing and legacy mapping remain shared.
    pub fn decode(&self, limits: Limits) -> Result<DecodedRecord, json::Error> {
        let value = json::parse_utf16(&self.text, limits)?;
        if matches!(value.get("sessionUpdate"), Some(Value::String(_))) {
            return Ok(DecodedRecord::Updates(vec![value]));
        }
        if matches!(value.get("event"), Some(Value::String(_))) {
            let Value::Array(updates) = poe_acp_client_rust::stream::legacy(&value) else {
                unreachable!("legacy mapping always returns an update array");
            };
            return Ok(DecodedRecord::Updates(updates));
        }
        Ok(DecodedRecord::Unknown)
    }
}

#[derive(Default)]
pub struct LogReader {
    pending: Vec<u16>,
    line_number: u64,
    skip_lf: bool,
    ended: bool,
}
impl LogReader {
    fn complete(&mut self) -> Option<Record> {
        self.line_number += 1;
        let pending = std::mem::take(&mut self.pending);
        let trimmed = trim_ecmascript(&pending);
        if trimmed.is_empty() {
            None
        } else {
            let text = if trimmed.len() == pending.len() {
                pending
            } else {
                trimmed.to_vec()
            };
            Some(Record {
                line_number: self.line_number,
                text,
            })
        }
    }
    pub fn push(&mut self, chunk: &[u16]) -> Vec<Record> {
        let mut records = vec![];
        if self.ended {
            return records;
        }
        let mut start = 0;
        for (index, &unit) in chunk.iter().enumerate() {
            if std::mem::take(&mut self.skip_lf) && unit == 10 {
                start = index + 1;
                continue;
            }
            if unit == 10 || unit == 13 {
                self.pending.extend_from_slice(&chunk[start..index]);
                if let Some(record) = self.complete() {
                    records.push(record);
                }
                start = index + 1;
                self.skip_lf = unit == 13;
            }
        }
        self.pending.extend_from_slice(&chunk[start..]);
        records
    }
    pub fn end(&mut self) -> Option<Record> {
        self.ended = true;
        if self.pending.is_empty() {
            None
        } else {
            self.complete()
        }
    }
    pub fn retained_capacity(&self) -> usize {
        self.pending.capacity()
    }
}
