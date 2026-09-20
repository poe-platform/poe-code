use mcp_protocol_rust::{json::Value, jsonrpc::RpcError};
use toolcraft_schema_rust::ValidationIssue;

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
