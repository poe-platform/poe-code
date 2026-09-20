//! Client response envelopes deliberately differ from server request admission.
use mcp_protocol_rust::json::{self, Limits, Value};
#[derive(Debug, PartialEq)]
pub enum ParsedMessage {
    Request(Value),
    Notification(Value),
    Response(Value),
    Invalid {
        id: Value,
        code: i32,
        message: &'static str,
    },
}
pub fn parse_message(line: &[u16]) -> ParsedMessage {
    match json::parse_utf16(line, Limits::default()) {
        Ok(value) => parse_payload(value),
        Err(_) => ParsedMessage::Invalid {
            id: Value::Null,
            code: -32700,
            message: "Parse error",
        },
    }
}
pub fn parse_payload(value: Value) -> ParsedMessage {
    let id = value
        .get("id")
        .filter(|value| matches!(value, Value::Number(_) | Value::String(_)))
        .cloned()
        .unwrap_or(Value::Null);
    let invalid = |id| ParsedMessage::Invalid {
        id,
        code: -32600,
        message: "Invalid Request",
    };
    if !matches!(value.get("jsonrpc"), Some(Value::String(version)) if version.iter().copied().eq("2.0".encode_utf16()))
    {
        return invalid(id);
    }
    if let Some(method) = value.get("method") {
        if !matches!(method, Value::String(_)) {
            return invalid(id);
        }
        let has_id = value.get("id").is_some();
        if has_id && id == Value::Null {
            return invalid(Value::Null);
        }
        let mut message = vec![(units("jsonrpc"), Value::String(units("2.0")))];
        if has_id {
            message.push((units("id"), id));
        }
        message.push((units("method"), method.clone()));
        if let Some(params) = value.get("params") {
            message.push((units("params"), params.clone()));
        }
        return if has_id {
            ParsedMessage::Request(Value::Object(message))
        } else {
            ParsedMessage::Notification(Value::Object(message))
        };
    }
    if id == Value::Null {
        return invalid(id);
    }
    let result = value.get("result");
    let error = value.get("error");
    if result.is_some() == error.is_some() {
        return invalid(id);
    }
    let (key, payload) = if let Some(result) = result {
        ("result", result)
    } else {
        let error = error.expect("exactly one response branch");
        if !matches!(error.get("code"), Some(Value::Number(code)) if code.is_finite() && code.fract() == 0.0)
            || !matches!(error.get("message"), Some(Value::String(_)))
        {
            return invalid(id);
        }
        ("error", error)
    };
    ParsedMessage::Response(Value::Object(vec![
        (units("jsonrpc"), Value::String(units("2.0"))),
        (units("id"), id),
        (units(key), payload.clone()),
    ]))
}
impl ParsedMessage {
    pub fn into_value(self) -> Value {
        let (kind, message) = match self {
            Self::Request(message) => ("request", message),
            Self::Notification(message) => ("notification", message),
            Self::Response(message) => ("response", message),
            Self::Invalid { id, code, message } => {
                return Value::Object(vec![
                    (units("type"), Value::String(units("invalid"))),
                    (units("id"), id),
                    (
                        units("error"),
                        Value::Object(vec![
                            (units("code"), Value::Number(code.into())),
                            (units("message"), Value::String(units(message))),
                        ]),
                    ),
                ]);
            }
        };
        Value::Object(vec![
            (units("type"), Value::String(units(kind))),
            (units("message"), message),
        ])
    }
}
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
