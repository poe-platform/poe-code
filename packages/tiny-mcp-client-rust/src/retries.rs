//! Modern result validation and bounded input-request retry state.
use mcp_protocol_rust::{json::Value, jsonrpc::RpcError};
use tiny_stdio_mcp_server_rust::protocol::{validate_definition, validate_input_required};

#[derive(Debug, PartialEq)]
pub struct InputRequest {
    pub key: Vec<u16>,
    pub method: String,
    pub params: Option<Value>,
}
#[derive(Debug, PartialEq)]
pub enum ResultAction {
    Complete(Value),
    Inputs(Vec<InputRequest>),
}
pub struct RetryState {
    method: String,
    original: Option<Value>,
    round: usize,
    state: Option<Value>,
    responses: Option<Vec<(Vec<u16>, Value)>>,
}
impl RetryState {
    pub fn new(method: String, original: Option<Value>) -> Self {
        Self {
            method,
            original,
            round: 0,
            state: None,
            responses: None,
        }
    }
    pub fn process_result(
        &mut self,
        result: Value,
        capabilities: &Value,
        handlers: &[String],
    ) -> Result<ResultAction, RpcError> {
        let kind = result.get("resultType");
        if !matches!(&result, Value::Object(_))
            || !(matches_text(kind, "complete") || matches_text(kind, "input_required"))
        {
            return Err(error(-32600, "Invalid modern resultType"));
        }
        if matches_text(kind, "complete") {
            if matches!(
                self.method.as_str(),
                "server/discover"
                    | "tools/list"
                    | "prompts/list"
                    | "resources/list"
                    | "resources/templates/list"
                    | "resources/read"
            ) {
                if !matches!(result.get("ttlMs"), Some(Value::Number(ttl)) if ttl.is_finite() && ttl.fract() == 0.0 && (0.0..=9_007_199_254_740_991.0).contains(ttl))
                {
                    return Err(error(
                        -32600,
                        "MCP cache ttlMs must be a nonnegative safe integer",
                    ));
                }
                if !(matches_text(result.get("cacheScope"), "public")
                    || matches_text(result.get("cacheScope"), "private"))
                {
                    return Err(error(-32600, "MCP cacheScope must be public or private"));
                }
            }
            if let Some(definition) = result_definition(&self.method)
                && !validate_definition(definition, &result)
            {
                return Err(error(-32600, &format!("Invalid {} result", self.method)));
            }
            return Ok(ResultAction::Complete(result));
        }
        validate_input_required(&self.method, &result, capabilities).map_err(|mut error| {
            if error.code == -32603 {
                error.code = -32600;
            }
            error
        })?;
        if self.round == 64 {
            return Err(error(-32600, "MCP input round limit exceeded"));
        }
        let requests = match result.get("inputRequests") {
            Some(Value::Object(requests)) => requests.as_slice(),
            _ => &[],
        };
        if requests.len() > 64 {
            return Err(error(-32600, "MCP input request limit exceeded"));
        }
        let mut inputs = Vec::with_capacity(requests.len());
        for (key, request) in requests {
            let Some(Value::String(method)) = request.get("method") else {
                unreachable!("validated input method");
            };
            let method = String::from_utf16_lossy(method);
            if !handlers.contains(&method) {
                return Err(error(-32021, "Unsupported MCP input request"));
            }
            inputs.push(InputRequest {
                key: key.clone(),
                method,
                params: request.get("params").cloned(),
            });
        }
        self.round += 1;
        self.state = result.get("requestState").cloned();
        self.responses = result.get("inputRequests").map(|_| vec![]);
        Ok(ResultAction::Inputs(inputs))
    }
    pub fn record_response(
        &mut self,
        key: Vec<u16>,
        method: &str,
        response: Value,
    ) -> Result<(), RpcError> {
        let definition = match method {
            "roots/list" => "ListRootsResult",
            "sampling/createMessage" => "CreateMessageResult",
            "elicitation/create" => "ElicitResult",
            _ => return Err(error(-32600, "Invalid MCP input response")),
        };
        if !validate_definition(definition, &response) {
            return Err(error(-32600, "Invalid MCP input response"));
        }
        let Some(responses) = &mut self.responses else {
            return Err(error(-32600, "Invalid MCP input response"));
        };
        responses.push((key, response));
        Ok(())
    }
    pub fn next_params(&self) -> Value {
        let mut params = match &self.original {
            Some(Value::Object(params)) => params
                .iter()
                .filter(|(key, _)| {
                    !key.iter().copied().eq("requestState".encode_utf16())
                        && !key.iter().copied().eq("inputResponses".encode_utf16())
                })
                .cloned()
                .collect::<Vec<_>>(),
            _ => vec![],
        };
        if let Some(state) = &self.state {
            params.push((units("requestState"), state.clone()));
        }
        if let Some(responses) = &self.responses {
            params.push((units("inputResponses"), Value::Object(responses.clone())));
        }
        Value::Object(params)
    }
}
fn error(code: i32, message: &str) -> RpcError {
    RpcError {
        code,
        message: message.into(),
        data: None,
    }
}
fn units(source: &str) -> Vec<u16> {
    source.encode_utf16().collect()
}
fn matches_text(value: Option<&Value>, expected: &str) -> bool {
    matches!(value, Some(Value::String(text)) if text.iter().copied().eq(expected.encode_utf16()))
}
fn result_definition(method: &str) -> Option<&'static str> {
    match method {
        "server/discover" => Some("DiscoverResult"),
        "tools/list" => Some("ListToolsResult"),
        "tools/call" => Some("CallToolResult"),
        "prompts/list" => Some("ListPromptsResult"),
        "prompts/get" => Some("GetPromptResult"),
        "resources/list" => Some("ListResourcesResult"),
        "resources/templates/list" => Some("ListResourceTemplatesResult"),
        "resources/read" => Some("ReadResourceResult"),
        "completion/complete" => Some("CompleteResult"),
        "ping" | "logging/setLevel" => Some("Result"),
        _ => None,
    }
}
