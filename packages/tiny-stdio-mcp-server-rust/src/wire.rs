use mcp_protocol_rust::{
    json::Limits,
    jsonrpc::{Id, Request, RpcError},
};

#[derive(Debug, PartialEq)]
pub enum LineMessage {
    Ignore,
    Dispatch(Request),
    Error { id: Id, error: RpcError },
}

pub fn parse_line(line: &[u16], limits: Limits) -> LineMessage {
    let request = match mcp_protocol_rust::jsonrpc::parse_message_utf16(line, limits) {
        mcp_protocol_rust::jsonrpc::ParsedMessage::Error { id, error } => {
            return LineMessage::Error { id, error };
        }
        mcp_protocol_rust::jsonrpc::ParsedMessage::Request(request) => request,
    };
    let method = String::from_utf16_lossy(&request.method);
    if request.id.is_none()
        && (method == "initialize"
            || (!method.starts_with("notifications/")
                && crate::select_protocol(&method, request.params.as_ref()) == Ok(true)))
    {
        return LineMessage::Ignore;
    }
    if let Some(id) = &request.id
        && method == "notifications/initialized"
    {
        return LineMessage::Error {
            id: id.clone(),
            error: RpcError {
                code: -32600,
                message: "Invalid Request".into(),
                data: None,
            },
        };
    }
    LineMessage::Dispatch(request)
}
