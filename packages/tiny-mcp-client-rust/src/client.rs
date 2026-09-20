//! Owned MCP connection state and result contracts, independent of Node I/O.
use mcp_protocol_rust::{
    formats::{is_base64, is_valid_uri},
    json::Value,
};
use std::collections::{BTreeSet, HashMap};
use tiny_stdio_mcp_server_rust::protocol::validate_definition;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ConnectionState {
    #[default]
    Disconnected,
    Initializing,
    Ready,
    Closed,
}
#[derive(Debug)]
pub struct ClientError {
    pub code: Option<i32>,
    pub message: Vec<u16>,
}
#[derive(Hash, PartialEq, Eq)]
enum Token {
    String(Vec<u16>),
    Number(u64),
}
impl Token {
    fn from(value: &Value) -> Option<Self> {
        match value {
            Value::String(text) => Some(Self::String(text.clone())),
            Value::Number(number) => Some(Self::Number(if *number == 0.0 {
                0
            } else if number.is_nan() {
                f64::NAN.to_bits()
            } else {
                number.to_bits()
            })),
            _ => None,
        }
    }
}
#[derive(Default)]
pub struct ClientState {
    state: ConnectionState,
    generation: u64,
    modern: bool,
    server_capabilities: Option<Value>,
    client_capabilities: Option<Value>,
    server_info: Option<Value>,
    instructions: Option<Vec<u16>>,
    subscribed: BTreeSet<Vec<u16>>,
    progress: HashMap<Token, usize>,
}
impl ClientState {
    pub fn state(&self) -> ConnectionState {
        self.state
    }
    pub fn modern(&self) -> bool {
        self.modern
    }
    pub fn server_capabilities(&self) -> Option<Value> {
        self.server_capabilities.clone()
    }
    pub fn server_info(&self) -> Option<Value> {
        self.server_info.clone()
    }
    pub fn instructions(&self) -> Option<Vec<u16>> {
        self.instructions.clone()
    }
    pub fn begin_connect(&mut self) -> Result<u64, ClientError> {
        if !matches!(
            self.state,
            ConnectionState::Disconnected | ConnectionState::Closed
        ) {
            return Err(error(None, "MCP client is already connected"));
        }
        self.generation = self
            .generation
            .checked_add(1)
            .filter(|value| *value <= 9_007_199_254_740_991)
            .ok_or_else(|| error(None, "MCP connection identifier exhausted"))?;
        self.clear();
        self.modern = false;
        self.state = ConnectionState::Initializing;
        Ok(self.generation)
    }
    pub fn connection_closed(&mut self, generation: u64) -> bool {
        if generation != self.generation {
            return false;
        }
        self.state = ConnectionState::Closed;
        true
    }
    pub fn connection_failed(&mut self, generation: u64) -> bool {
        if generation != self.generation {
            return false;
        }
        self.state = ConnectionState::Disconnected;
        true
    }
    pub fn set_client_capabilities(&mut self, value: Value) -> Result<(), ClientError> {
        if !validate_definition("ClientCapabilities", &value) {
            return Err(error(Some(-32602), "Invalid client capabilities"));
        }
        self.client_capabilities = Some(value);
        Ok(())
    }
    pub fn accept_initialize(
        &mut self,
        generation: u64,
        result: Value,
    ) -> Result<Value, ClientError> {
        self.ensure_generation(generation)?;
        if !matches!(&result, Value::Object(_))
            || !matches!(result.get("protocolVersion"), Some(Value::String(_)))
            || !result.get("capabilities").is_some_and(server_capabilities)
            || !result.get("serverInfo").is_some_and(|info| {
                ["name", "version"].iter().all(
                    |name| matches!(info.get(name), Some(Value::String(text)) if !text.is_empty()),
                )
            })
            || !optional_string(result.get("instructions"))
        {
            return Err(error(Some(-32600), "Invalid initialize result"));
        }
        if !text_is(result.get("protocolVersion"), "2025-03-26") {
            let Some(Value::String(version)) = result.get("protocolVersion") else {
                unreachable!()
            };
            return Err(ClientError {
                code: Some(-32600),
                message: units("Unsupported protocol version: ")
                    .into_iter()
                    .chain(version.iter().copied())
                    .collect(),
            });
        }
        self.server_capabilities = result.get("capabilities").cloned();
        self.server_info = result.get("serverInfo").cloned();
        self.instructions = match result.get("instructions") {
            Some(Value::String(text)) => Some(text.clone()),
            _ => None,
        };
        self.modern = false;
        self.state = ConnectionState::Ready;
        Ok(result)
    }
    pub fn accept_discovery(
        &mut self,
        generation: u64,
        result: Value,
    ) -> Result<Value, ClientError> {
        self.ensure_generation(generation)?;
        if !text_is(result.get("resultType"), "complete")
            || !matches!(result.get("supportedVersions"), Some(Value::Array(versions)) if versions.iter().all(|version| matches!(version, Value::String(_))))
            || !result.get("capabilities").is_some_and(server_capabilities)
        {
            return Err(error(Some(-32600), "Invalid server/discover result"));
        }
        if !matches!(result.get("ttlMs"), Some(Value::Number(ttl)) if ttl.is_finite() && ttl.fract() == 0.0 && (0.0..=9_007_199_254_740_991.0).contains(ttl))
        {
            return Err(error(
                Some(-32600),
                "MCP cache ttlMs must be a nonnegative safe integer",
            ));
        }
        if !(text_is(result.get("cacheScope"), "public")
            || text_is(result.get("cacheScope"), "private"))
        {
            return Err(error(
                Some(-32600),
                "MCP cacheScope must be public or private",
            ));
        }
        if !validate_definition("DiscoverResult", &result) {
            return Err(error(Some(-32600), "Invalid server/discover result"));
        }
        if !matches!(result.get("supportedVersions"), Some(Value::Array(versions)) if versions.iter().any(|version| text_is(Some(version), "2026-07-28")))
        {
            return Err(error(
                Some(-32022),
                "No mutually supported modern protocol version",
            ));
        }
        let identity = result
            .get("_meta")
            .and_then(|metadata| metadata.get("io.modelcontextprotocol/serverInfo"));
        if identity.is_some_and(|info| {
            !matches!(info, Value::Object(_))
                || !["name", "version"]
                    .iter()
                    .all(|name| matches!(info.get(name), Some(Value::String(_))))
        }) {
            return Err(error(Some(-32600), "Invalid discovery serverInfo"));
        }
        if !optional_string(result.get("instructions")) {
            return Err(error(Some(-32600), "Invalid discovery instructions"));
        }
        self.server_capabilities = result.get("capabilities").cloned();
        self.server_info = identity.cloned();
        self.instructions = match result.get("instructions") {
            Some(Value::String(text)) => Some(text.clone()),
            _ => None,
        };
        self.modern = true;
        self.state = ConnectionState::Ready;
        let mut connected = vec![
            (units("protocolVersion"), Value::String(units("2026-07-28"))),
            (
                units("capabilities"),
                self.server_capabilities
                    .clone()
                    .expect("validated capabilities"),
            ),
        ];
        if let Some(info) = &self.server_info {
            connected.push((units("serverInfo"), info.clone()));
        }
        if let Some(instructions) = &self.instructions {
            connected.push((units("instructions"), Value::String(instructions.clone())));
        }
        Ok(Value::Object(connected))
    }
    pub fn require_capability(&self, capability: &str) -> Result<(), ClientError> {
        self.require_connection()?;
        let Some(capabilities) = &self.server_capabilities else {
            return Err(error(None, "MCP client has not completed initialization"));
        };
        if capabilities.get(capability).is_none() {
            return Err(error(
                None,
                &format!("Server does not support {capability}"),
            ));
        }
        Ok(())
    }
    pub fn require_connection(&self) -> Result<(), ClientError> {
        match self.state {
            ConnectionState::Disconnected => Err(error(None, "MCP client is disconnected")),
            ConnectionState::Closed => Err(error(None, "MCP client is closed")),
            _ => Ok(()),
        }
    }
    pub fn validate_result(&self, method: &str, result: &Value) -> Result<(), ClientError> {
        let valid = match method {
            "tools/list" => matches!(result.get("tools"), Some(Value::Array(tools)) if tools.iter().all(|tool| matches!(tool.get("name"), Some(Value::String(_))) && matches!(tool.get("inputSchema"), Some(Value::Object(_))) && text_is(tool.get("inputSchema").and_then(|schema| schema.get("type")), "object"))) && optional_string(result.get("nextCursor")),
            "tools/call" => matches!(result.get("content"), Some(Value::Array(content)) if content.iter().all(content_item)) && (self.modern || result.get("structuredContent").is_none_or(|value| matches!(value, Value::Object(_)))) && result.get("isError").is_none_or(|value| matches!(value, Value::Bool(_))),
            "resources/list" => matches!(result.get("resources"), Some(Value::Array(resources)) if resources.iter().all(resource)) && optional_string(result.get("nextCursor")),
            "resources/templates/list" => matches!(result.get("resourceTemplates"), Some(Value::Array(templates)) if templates.iter().all(|template| matches!(template.get("uriTemplate"), Some(Value::String(_))) && matches!(template.get("name"), Some(Value::String(_))) && ["description", "mimeType"].iter().all(|name| optional_string(template.get(name))))) && optional_string(result.get("nextCursor")),
            "resources/read" => matches!(result.get("contents"), Some(Value::Array(contents)) if contents.iter().all(resource_contents)),
            "prompts/get" => optional_string(result.get("description")) && matches!(result.get("messages"), Some(Value::Array(messages)) if messages.iter().all(|message| (text_is(message.get("role"), "user") || text_is(message.get("role"), "assistant")) && message.get("content").is_some_and(content_item))),
            "completion/complete" => result.get("completion").is_some_and(|completion| matches!(completion.get("values"), Some(Value::Array(values)) if values.iter().all(|value| matches!(value, Value::String(_)))) && completion.get("hasMore").is_none_or(|value| matches!(value, Value::Bool(_))) && completion.get("total").is_none_or(|value| matches!(value, Value::Number(_)))),
            _ => true,
        };
        if !valid {
            return Err(error(
                Some(-32600),
                &if method == "tools/call" {
                    "Invalid tool result".into()
                } else {
                    format!("Invalid {method} result")
                },
            ));
        }
        Ok(())
    }
    pub fn add_subscription(&mut self, uri: Vec<u16>) {
        self.subscribed.insert(uri);
    }
    pub fn remove_subscription(&mut self, uri: &[u16]) {
        self.subscribed.remove(uri);
    }
    pub fn track_progress(&mut self, value: &Value, add: bool) {
        let Some(token) = Token::from(value) else {
            return;
        };
        if add {
            *self.progress.entry(token).or_default() += 1;
        } else if let Some(count) = self.progress.get_mut(&token) {
            if *count > 1 {
                *count -= 1;
            } else {
                self.progress.remove(&token);
            }
        }
    }
    pub fn notification_allowed(&self, method: &str, params: &Value) -> bool {
        let list = match method {
            "notifications/tools/list_changed" => Some("tools"),
            "notifications/prompts/list_changed" => Some("prompts"),
            "notifications/resources/list_changed" => Some("resources"),
            _ => None,
        };
        if let Some(capability) = list {
            return self
                .server_capabilities
                .as_ref()
                .and_then(|caps| caps.get(capability))
                .and_then(|cap| cap.get("listChanged"))
                == Some(&Value::Bool(true));
        }
        if method == "notifications/resources/updated" {
            return matches!(params.get("uri"), Some(Value::String(uri)) if self.subscribed.contains(uri));
        }
        if method == "notifications/progress" {
            return params
                .get("progressToken")
                .and_then(Token::from)
                .is_some_and(|token| self.progress.contains_key(&token))
                && matches!(params.get("progress"), Some(Value::Number(_)))
                && params
                    .get("total")
                    .is_none_or(|value| matches!(value, Value::Number(_)))
                && optional_string(params.get("message"));
        }
        if method == "notifications/message" {
            return matches!(params.get("level"), Some(Value::String(level)) if ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"].iter().any(|value| level.iter().copied().eq(value.encode_utf16())))
                && params.get("data").is_some()
                && optional_string(params.get("logger"));
        }
        false
    }
    pub fn roots_changes_allowed(&self) -> bool {
        self.client_capabilities
            .as_ref()
            .and_then(|cap| cap.get("roots"))
            .and_then(|roots| roots.get("listChanged"))
            == Some(&Value::Bool(true))
    }
    pub fn close(&mut self) {
        self.clear();
        self.state = ConnectionState::Closed;
    }
    fn clear(&mut self) {
        self.server_capabilities = None;
        self.client_capabilities = None;
        self.server_info = None;
        self.instructions = None;
        self.subscribed.clear();
        self.progress.clear();
    }
    fn ensure_generation(&self, generation: u64) -> Result<(), ClientError> {
        if generation == self.generation && self.state == ConnectionState::Initializing {
            Ok(())
        } else {
            Err(error(None, "MCP connection is no longer active"))
        }
    }
}
fn error(code: Option<i32>, message: &str) -> ClientError {
    ClientError {
        code,
        message: units(message),
    }
}
fn units(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn text_is(value: Option<&Value>, expected: &str) -> bool {
    matches!(value, Some(Value::String(text)) if text.iter().copied().eq(expected.encode_utf16()))
}
fn optional_string(value: Option<&Value>) -> bool {
    value.is_none_or(|value| matches!(value, Value::String(_)))
}
fn server_capabilities(value: &Value) -> bool {
    matches!(value, Value::Object(_))
        && [
            "prompts",
            "resources",
            "tools",
            "logging",
            "completions",
            "experimental",
        ]
        .iter()
        .all(|name| {
            value
                .get(name)
                .is_none_or(|value| matches!(value, Value::Object(_)))
        })
}
fn resource(value: &Value) -> bool {
    matches!(value.get("uri"), Some(Value::String(uri)) if is_valid_uri(uri))
        && matches!(value.get("name"), Some(Value::String(_)))
        && ["description", "mimeType"]
            .iter()
            .all(|name| optional_string(value.get(name)))
        && value
            .get("size")
            .is_none_or(|value| matches!(value, Value::Number(_)))
}
fn resource_contents(value: &Value) -> bool {
    matches!(value.get("uri"), Some(Value::String(uri)) if is_valid_uri(uri))
        && optional_string(value.get("mimeType"))
        && (value.get("text").is_some() || value.get("blob").is_some())
        && value
            .get("text")
            .is_none_or(|value| matches!(value, Value::String(_)))
        && value
            .get("blob")
            .is_none_or(|value| matches!(value, Value::String(blob) if is_base64(blob)))
}
fn content_item(value: &Value) -> bool {
    if text_is(value.get("type"), "text") {
        return matches!(value.get("text"), Some(Value::String(_)));
    }
    if text_is(value.get("type"), "image") || text_is(value.get("type"), "audio") {
        return matches!(value.get("data"), Some(Value::String(data)) if is_base64(data))
            && matches!(value.get("mimeType"), Some(Value::String(_)));
    }
    if text_is(value.get("type"), "resource_link") {
        return resource(value);
    }
    text_is(value.get("type"), "resource") && value.get("resource").is_some_and(resource_contents)
}
