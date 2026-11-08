//! HTTP JSON-RPC classification; malformed batch entries retain their positions.
use mcp_protocol_rust::{
    json::{self, Limits, Value},
    jsonrpc::{self, ParsedMessage},
};
#[derive(Debug, PartialEq)]
pub enum BodyError {
    Plain(&'static str),
    Message {
        id: Value,
        code: i32,
        message: String,
    },
}
pub fn classify(body: Value, max_batch: Option<f64>) -> Result<Value, BodyError> {
    let batch = matches!(body, Value::Array(_));
    let input = match body {
        Value::Array(a) => {
            if a.is_empty() {
                return Err(BodyError::Plain("Invalid Request"));
            }
            if max_batch.is_some_and(|limit| a.len() as f64 > limit) {
                return Err(BodyError::Plain("Batch size exceeds configured limit"));
            }
            a
        }
        v @ Value::Object(_) => vec![v],
        _ => return Err(BodyError::Plain("Invalid Request")),
    };
    let (mut entries, mut kinds) = (vec![], vec![]);
    for value in input {
        if valid_response(&value) {
            kinds.push(Value::Number(3.0));
            entries.push(value);
            continue;
        }
        if matches!(&value, Value::Object(_))
            && (value.get("result").is_some() || value.get("error").is_some())
        {
            if !batch {
                return Err(BodyError::Plain("Invalid Request"));
            }
            entries.push(Value::Null);
            kinds.push(Value::Number(0.0));
            continue;
        }
        match jsonrpc::parse_message(json::stringify(&value).as_bytes(), Limits::default()) {
            ParsedMessage::Error { id, error } => {
                if !batch {
                    return Err(BodyError::Message {
                        id: id.into_value(),
                        code: error.code,
                        message: error.message,
                    });
                }
                entries.push(Value::Null);
                kinds.push(Value::Number(0.0));
            }
            ParsedMessage::Request(request) => {
                let mut fields = vec![
                    (key("jsonrpc"), text("2.0")),
                    (key("method"), Value::String(request.method)),
                ];
                let notification = request.id.is_none();
                if let Some(id) = request.id {
                    fields.push((key("id"), id.into_value()))
                }
                if let Some(params) = request.params {
                    fields.push((key("params"), params))
                }
                kinds.push(Value::Number(if notification { 2.0 } else { 1.0 }));
                entries.push(Value::Object(fields));
            }
        }
    }
    Ok(Value::Object(vec![
        (key("isBatch"), Value::Bool(batch)),
        (key("entries"), Value::Array(entries)),
        (
            key("hasRequests"),
            Value::Bool(kinds.contains(&Value::Number(1.0))),
        ),
        (
            key("hasNotifications"),
            Value::Bool(kinds.contains(&Value::Number(2.0))),
        ),
        (
            key("hasResponses"),
            Value::Bool(kinds.contains(&Value::Number(3.0))),
        ),
        (key("kinds"), Value::Array(kinds)),
    ]))
}
fn key(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn text(s: &str) -> Value {
    Value::String(key(s))
}
fn is_string(v: Option<&Value>, s: &str) -> bool {
    matches!(v,Some(Value::String(a)) if a.iter().copied().eq(s.encode_utf16()))
}
fn valid_response(v: &Value) -> bool {
    if !matches!(v, Value::Object(_))
        || !is_string(v.get("jsonrpc"), "2.0")
        || v.get("method").is_some()
        || !matches!(
            v.get("id"),
            Some(Value::Null | Value::String(_) | Value::Number(_))
        )
    {
        return false;
    }
    let result = v.get("result").is_some();
    let error = v.get("error");
    if result == error.is_some() {
        return false;
    }
    error.is_none_or(|e| {
        matches!(e, Value::Object(_))
            && matches!(e.get("code"), Some(Value::Number(_)))
            && matches!(e.get("message"), Some(Value::String(_)))
    })
}
#[derive(Debug)]
pub struct ByteBudget {
    limit: Option<f64>,
    total: u64,
    rejected: bool,
}
impl ByteBudget {
    pub fn new(limit: Option<f64>) -> Self {
        Self {
            limit,
            total: 0,
            rejected: false,
        }
    }
    pub fn admit(&mut self, bytes: u64) -> bool {
        if self.rejected {
            return false;
        }
        let Some(total) = self.total.checked_add(bytes) else {
            self.rejected = true;
            return false;
        };
        self.total = total;
        self.rejected = self.limit.is_some_and(|limit| total as f64 > limit);
        !self.rejected
    }
}
