use crate::json::{self, JsonString, Limits, Value};

pub const PARSE_ERROR: i32 = -32700;
pub const INVALID_REQUEST: i32 = -32600;
pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;
pub const INTERNAL_ERROR: i32 = -32603;
pub const RESOURCE_NOT_FOUND: i32 = -32002;
pub const UNSUPPORTED_PROTOCOL_VERSION: i32 = -32022;

#[derive(Clone, Debug, PartialEq)]
pub enum Id {
    Null,
    String(JsonString),
    Number(f64),
}

impl Id {
    pub fn into_value(self) -> Value {
        match self {
            Self::Null => Value::Null,
            Self::String(value) => Value::String(value),
            Self::Number(value) => Value::Number(value),
        }
    }

    pub fn is_safe_request_id(&self) -> bool {
        match self {
            Self::String(_) => true,
            Self::Number(value) => {
                value.is_finite() && value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0
            }
            Self::Null => false,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    pub data: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    pub id: Option<Id>,
    pub method: JsonString,
    pub params: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ParsedMessage {
    Request(Request),
    Error { id: Id, error: RpcError },
}

pub fn parse_message(input: &[u8], limits: Limits) -> ParsedMessage {
    let value = match json::parse(input, limits) {
        Ok(value) => value,
        Err(_) => return invalid(Id::Null, PARSE_ERROR, "Parse error"),
    };
    let Value::Object(properties) = value else {
        return invalid(Id::Null, INVALID_REQUEST, "Invalid Request");
    };
    let mut wire_version = None;
    let mut wire_id = None;
    let mut method = None;
    let mut params = None;
    for (key, value) in properties {
        if key.iter().copied().eq("jsonrpc".encode_utf16()) {
            wire_version = Some(value);
        } else if key.iter().copied().eq("id".encode_utf16()) {
            wire_id = Some(value);
        } else if key.iter().copied().eq("method".encode_utf16()) {
            method = Some(value);
        } else if key.iter().copied().eq("params".encode_utf16()) {
            params = Some(value);
        }
    }
    let modern = params.as_ref()
        .and_then(|value| value.get("_meta"))
        .and_then(|value| value.get("io.modelcontextprotocol/protocolVersion"))
        .is_some_and(|value| matches!(value, Value::String(units) if units.iter().copied().eq("2026-07-28".encode_utf16())));
    let has_id = wire_id.is_some();
    let (id, invalid_id) = match wire_id {
        None | Some(Value::Null) => (Id::Null, false),
        Some(Value::String(value)) => (Id::String(value), false),
        Some(Value::Number(value)) if value.is_finite() => (Id::Number(value), false),
        _ => (Id::Null, true),
    };
    if modern && has_id && (invalid_id || !id.is_safe_request_id()) {
        return invalid(Id::Null, INVALID_REQUEST, "Invalid Request ID");
    }
    if params
        .as_ref()
        .is_some_and(|value| !matches!(value, Value::Object(_)))
    {
        return invalid(id, INVALID_REQUEST, "Invalid Request");
    }
    if !matches!(wire_version, Some(Value::String(units)) if units.iter().copied().eq("2.0".encode_utf16()))
    {
        return invalid(id, INVALID_REQUEST, "Invalid Request");
    }
    let Some(Value::String(method)) = method else {
        return invalid(id, INVALID_REQUEST, "Invalid Request");
    };
    if invalid_id {
        return invalid(Id::Null, INVALID_REQUEST, "Invalid Request");
    }
    ParsedMessage::Request(Request {
        id: has_id.then_some(id),
        method,
        params,
    })
}

fn invalid(id: Id, code: i32, message: &str) -> ParsedMessage {
    ParsedMessage::Error {
        id,
        error: RpcError {
            code,
            message: message.into(),
            data: None,
        },
    }
}

pub fn format_success_response(id: Id, result: Value) -> String {
    json::stringify(&Value::Object(vec![
        (
            "jsonrpc".encode_utf16().collect(),
            Value::String("2.0".encode_utf16().collect()),
        ),
        ("id".encode_utf16().collect(), id.into_value()),
        ("result".encode_utf16().collect(), result),
    ]))
}

pub fn format_error_response(id: Id, error: RpcError) -> String {
    let mut payload = vec![
        (
            "code".encode_utf16().collect(),
            Value::Number(error.code as f64),
        ),
        (
            "message".encode_utf16().collect(),
            Value::String(error.message.encode_utf16().collect()),
        ),
    ];
    if let Some(data) = error.data {
        payload.push(("data".encode_utf16().collect(), data));
    }
    json::stringify(&Value::Object(vec![
        (
            "jsonrpc".encode_utf16().collect(),
            Value::String("2.0".encode_utf16().collect()),
        ),
        ("id".encode_utf16().collect(), id.into_value()),
        ("error".encode_utf16().collect(), Value::Object(payload)),
    ]))
}
