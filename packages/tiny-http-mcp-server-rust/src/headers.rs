//! Modern protocol mirrors reject duplicate, malformed, or inconsistent headers.
use mcp_protocol_rust::{json::Value, jsonrpc::RpcError};
pub fn validate_modern(headers: &Value, request: &Value) -> Option<RpcError> {
    let version = request
        .get("params")
        .and_then(|p| p.get("_meta"))
        .and_then(|m| m.get("io.modelcontextprotocol/protocolVersion"));
    if !matches!(version, Some(Value::String(_))) {
        return Some(RpcError {
            code: -32602,
            message: "Missing protocol version request metadata".into(),
            data: None,
        });
    }
    let mut expected = vec![("mcp-protocol-version", version)];
    if request.get("id").is_some() {
        expected.push(("mcp-method", request.get("method")));
        let method = request.get("method").and_then(|v| {
            if let Value::String(s) = v {
                Some(String::from_utf16_lossy(s))
            } else {
                None
            }
        });
        let name = match method.as_deref() {
            Some("tools/call" | "prompts/get") => Some("name"),
            Some("resources/read") => Some("uri"),
            _ => None,
        };
        if let Some(name) = name {
            expected.push(("mcp-name", request.get("params").and_then(|p| p.get(name))))
        }
    }
    for (name, value) in expected {
        let actual = match headers.get(name) {
            Some(Value::String(s)) => {
                if name == "mcp-name" {
                    tiny_stdio_mcp_server_rust::headers::decode_value(s)
                } else {
                    Some(s.clone())
                }
            }
            _ => None,
        };
        if !matches!(value,Some(Value::String(v)) if actual.as_ref()==Some(v)) {
            return Some(RpcError {
                code: -32020,
                message: format!("Header mismatch: {name} must match the request body"),
                data: None,
            });
        }
    }
    None
}
