use mcp_protocol_rust::{json::Value, jsonrpc::RpcError};
use toolcraft_schema_rust::ValidationIssue;

/// Build an object schema while preserving caller keyword data and UTF-16 keys.
pub fn define_schema(definition: Value) -> Result<Value, String> {
    let Value::Object(fields) = definition else {
        return Err("Schema definition must be an object".into());
    };
    let mut properties = Vec::with_capacity(fields.len());
    let mut required = Vec::new();
    let optional: Vec<u16> = "optional".encode_utf16().collect();
    for (name, property) in fields {
        let Value::Object(mut keywords) = property else {
            return Err("Schema property definition must be an object".into());
        };
        if !keywords
            .iter()
            .any(|(key, value)| key == &optional && json_truthy(value))
        {
            required.push(Value::String(name.clone()));
        }
        keywords.retain(|(key, _)| key != &optional);
        properties.push((name, Value::Object(keywords)));
    }
    Ok(super::object([
        ("type", super::string("object")),
        ("properties", Value::Object(properties)),
        ("required", Value::Array(required)),
    ]))
}

fn json_truthy(value: &Value) -> bool {
    match value {
        Value::Null | Value::Bool(false) => false,
        Value::Number(number) => *number != 0.0 && !number.is_nan(),
        Value::String(units) => !units.is_empty(),
        _ => true,
    }
}

pub(crate) fn validation_error(code: i32, prefix: &str, issues: Vec<ValidationIssue>) -> RpcError {
    let mut message = prefix.encode_utf16().collect::<Vec<_>>();
    for (index, issue) in issues.iter().enumerate() {
        if index > 0 {
            message.extend(", ".encode_utf16());
        }
        message.extend("data".encode_utf16());
        for segment in &issue.path {
            message.push(47);
            message.extend(segment);
        }
        message.push(32);
        message.extend(&issue.message);
    }
    RpcError {
        code,
        message: String::from_utf16_lossy(&message),
        data: Some(Value::Array(
            issues
                .into_iter()
                .map(|issue| {
                    super::object([
                        (
                            "path",
                            Value::Array(issue.path.into_iter().map(Value::String).collect()),
                        ),
                        ("expected", Value::String(issue.expected)),
                        ("received", super::string(&issue.received)),
                        ("message", Value::String(issue.message)),
                        ("keyword", Value::String(issue.keyword)),
                    ])
                })
                .collect(),
        )),
    }
}
