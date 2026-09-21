use crate::{o, s};
use mcp_protocol_rust::json::{self, Value};
pub fn code(value: &Value) -> bool {
    matches!(value,Value::Number(n) if n.is_finite()&&n.fract()==0.0&&(-2147483648.0..=2147483647.0).contains(n))
}
pub fn id(value: &Value) -> bool {
    matches!(value, Value::Null | Value::String(_))
        || matches!(value,Value::Number(n) if n.is_finite()&&n.fract()==0.0&&n.abs()<=9007199254740991.0)
}
pub fn error(code: i32, message: &str, data: Option<Value>) -> Value {
    let mut fields = vec![
        ("code", Value::Number(code as f64)),
        ("message", s(message)),
    ];
    if let Some(data) = data {
        fields.push(("data", data));
    }
    o(fields)
}
pub fn response(id: Value, error: Value) -> Value {
    o(vec![("jsonrpc", s("2.0")), ("id", id), ("error", error)])
}
fn invalid(id: Value, code: i32, message: &str) -> Value {
    o(vec![
        ("type", s("invalid")),
        ("id", id),
        ("error", error(code, message, None)),
    ])
}
pub fn parse(source: &[u16]) -> Value {
    let Ok(value) = json::parse_utf16(source, Default::default()) else {
        return invalid(Value::Null, -32700, "Parse error");
    };
    let id_value = value
        .get("id")
        .filter(|v| id(v))
        .cloned()
        .unwrap_or(Value::Null);
    if !matches!(value, Value::Object(_)) || value.get("jsonrpc") != Some(&s("2.0")) {
        return invalid(id_value, -32600, "Invalid Request");
    }
    let has_id = value.get("id").is_some();
    if let Some(method) = value.get("method") {
        if !matches!(method, Value::String(_)) || (has_id && !id(value.get("id").unwrap())) {
            return invalid(id_value, -32600, "Invalid Request");
        }
        let mut fields = vec![("jsonrpc", s("2.0"))];
        if has_id {
            fields.push(("id", id_value));
        }
        fields.push(("method", method.clone()));
        if let Some(params) = value.get("params") {
            fields.push(("params", params.clone()));
        }
        return o(vec![
            ("type", s(if has_id { "request" } else { "notification" })),
            ("message", o(fields)),
        ]);
    }
    if !has_id || !id(value.get("id").unwrap()) {
        return invalid(id_value, -32600, "Invalid Request");
    }
    let result = value.get("result");
    let error = value.get("error");
    if result.is_some() == error.is_some() {
        return invalid(id_value, -32600, "Invalid Request");
    }
    if let Some(error) = error
        && (!matches!(error, Value::Object(_))
            || !error.get("code").is_some_and(code)
            || !matches!(error.get("message"), Some(Value::String(_))))
    {
        return invalid(id_value, -32600, "Invalid Request");
    }
    o(vec![
        ("type", s("response")),
        (
            "message",
            o(vec![
                ("jsonrpc", s("2.0")),
                ("id", id_value),
                (
                    if result.is_some() { "result" } else { "error" },
                    result.or(error).unwrap().clone(),
                ),
            ]),
        ),
    ])
}
