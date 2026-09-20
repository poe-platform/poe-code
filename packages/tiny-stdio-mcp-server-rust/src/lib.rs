use mcp_protocol_rust::metadata::{is_valid_metadata, is_valid_metadata_key};
use mcp_protocol_rust::{
    json::Value,
    jsonrpc::{self, RpcError},
};

pub mod content;

pub const MODERN_PROTOCOL_VERSION: &str = "2026-07-28";
pub const DEFAULT_LEGACY_PROTOCOL_VERSION: &str = "2025-11-25";
pub const SUPPORTED_PROTOCOL_VERSIONS: [&str; 4] = [
    "2025-03-26",
    "2025-06-18",
    DEFAULT_LEGACY_PROTOCOL_VERSION,
    MODERN_PROTOCOL_VERSION,
];

#[derive(Clone, Debug)]
pub struct ServerOptions {
    pub name: String,
    pub version: String,
    pub support_notifications: bool,
    pub support_resource_subscriptions: bool,
}

pub struct Server {
    options: ServerOptions,
    tools: Vec<RegisteredTool>,
}

struct RegisteredTool {
    name: Vec<u16>,
    descriptor: Value,
    handler: u64,
}

pub struct Session {
    initialized: bool,
    notification_ready: bool,
    closed: bool,
    protocol_version: String,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            initialized: false,
            notification_ready: false,
            closed: false,
            protocol_version: DEFAULT_LEGACY_PROTOCOL_VERSION.into(),
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Action {
    Reply(Value),
    Error(RpcError),
    NoReply,
    Invoke {
        handler: u64,
        arguments: Value,
        context: Value,
    },
}

impl Session {
    pub fn close(&mut self) {
        self.closed = true;
        self.notification_ready = false;
    }
    pub fn protocol_version(&self) -> &str {
        &self.protocol_version
    }
    pub fn notifications_ready(&self) -> bool {
        self.notification_ready
    }
}

impl Server {
    pub fn new(options: ServerOptions) -> Self {
        Self {
            options,
            tools: vec![],
        }
    }

    pub fn set_tool(
        &mut self,
        definition: Value,
        handler: u64,
        replace: bool,
    ) -> Result<(), String> {
        let Some(Value::String(name)) = definition.get("name") else {
            return Err("Tool name required".into());
        };
        if name.is_empty() || String::from_utf16_lossy(name).trim().is_empty() {
            return Err("Tool name required".into());
        }
        let existing = self.tools.iter().position(|tool| &tool.name == name);
        if existing.is_some() && !replace {
            return Err(format!(
                "Tool already registered: {}",
                String::from_utf16_lossy(name)
            ));
        }
        if !definition.get("inputSchema").is_some_and(|value| {
            matches!(value, Value::Object(_)) && string_matches(value.get("type"), "object")
        }) {
            return Err("inputSchema must have type object".into());
        }
        let tool = RegisteredTool {
            name: name.clone(),
            descriptor: definition,
            handler,
        };
        match existing {
            Some(index) => self.tools[index] = tool,
            None => self.tools.push(tool),
        }
        Ok(())
    }

    pub fn remove_tool(&mut self, name: &str) -> bool {
        let Some(index) = self
            .tools
            .iter()
            .position(|tool| tool.name.iter().copied().eq(name.encode_utf16()))
        else {
            return false;
        };
        self.tools.remove(index);
        true
    }

    pub fn dispatch(&self, session: &mut Session, method: &str, params: Option<Value>) -> Action {
        if session.closed {
            return Action::NoReply;
        }
        let modern = match select_protocol(method, params.as_ref()) {
            Ok(modern) => modern,
            Err(error) => return Action::Error(error),
        };
        if method == "server/discover" {
            return Action::Reply(object([
                ("resultType", string("complete")),
                (
                    "supportedVersions",
                    Value::Array(
                        SUPPORTED_PROTOCOL_VERSIONS
                            .iter()
                            .rev()
                            .map(|value| string(value))
                            .collect(),
                    ),
                ),
                ("capabilities", self.capabilities()),
                (
                    "_meta",
                    object([("io.modelcontextprotocol/serverInfo", self.server_info())]),
                ),
                ("ttlMs", Value::Number(0.0)),
                ("cacheScope", string("private")),
            ]));
        }
        if method == "ping" {
            return Action::Reply(object([]));
        }
        if method == "initialize" {
            session.initialized = true;
            session.notification_ready = false;
            session.protocol_version = params
                .as_ref()
                .and_then(|value| value.get("protocolVersion"))
                .and_then(|value| {
                    SUPPORTED_PROTOCOL_VERSIONS[..3]
                        .iter()
                        .find(|version| string_matches(Some(value), version))
                })
                .copied()
                .unwrap_or(DEFAULT_LEGACY_PROTOCOL_VERSION)
                .into();
            return Action::Reply(object([
                ("protocolVersion", string(&session.protocol_version)),
                ("capabilities", self.capabilities()),
                ("serverInfo", self.server_info()),
            ]));
        }
        if method == "notifications/initialized" {
            if !session.initialized {
                return failure(jsonrpc::INVALID_REQUEST, "Server not initialized");
            }
            session.notification_ready = true;
            return Action::NoReply;
        }
        if !modern && !session.initialized {
            return failure(jsonrpc::INVALID_REQUEST, "Server not initialized");
        }
        if method == "tools/list" {
            let tools = self
                .tools
                .iter()
                .map(|tool| {
                    let Value::Object(properties) = &tool.descriptor else {
                        unreachable!("validated tool descriptor")
                    };
                    Value::Object(
                        properties
                            .iter()
                            .filter(|(name, value)| {
                                !name.iter().copied().eq("outputSchema".encode_utf16())
                                    || modern
                                    || string_matches(value.get("type"), "object")
                            })
                            .cloned()
                            .collect(),
                    )
                })
                .collect();
            let result = object([("tools", Value::Array(tools))]);
            return Action::Reply(if modern {
                self.decorate_cacheable(result)
            } else {
                result
            });
        }
        if method == "tools/call" {
            let name = match params.as_ref().and_then(|value| value.get("name")) {
                Some(Value::String(name)) if !name.is_empty() => name,
                _ => return failure(jsonrpc::INVALID_PARAMS, "Tool name required"),
            };
            let Some(tool) = self.tools.iter().find(|tool| &tool.name == name) else {
                let available = self
                    .tools
                    .iter()
                    .take(20)
                    .map(|tool| String::from_utf16_lossy(&tool.name))
                    .collect::<Vec<_>>()
                    .join(", ");
                return failure(
                    jsonrpc::INVALID_PARAMS,
                    &format!(
                        "Tool not found: {}{}",
                        String::from_utf16_lossy(name),
                        if available.is_empty() {
                            String::new()
                        } else {
                            format!(". Available: {available}")
                        }
                    ),
                );
            };
            let mut context = object([("clientCapabilities", object([]))]);
            if modern {
                let params = params.as_ref().expect("validated modern request");
                let Value::Object(fields) = &mut context else {
                    unreachable!("object context")
                };
                fields[0].1 = params
                    .get("_meta")
                    .and_then(|metadata| metadata.get("io.modelcontextprotocol/clientCapabilities"))
                    .expect("validated client capabilities")
                    .clone();
                for name in ["requestState", "inputResponses"] {
                    if let Some(value) = params.get(name) {
                        fields.push((name.encode_utf16().collect(), value.clone()));
                    }
                }
            }
            let arguments = params
                .and_then(|params| {
                    let Value::Object(properties) = params else {
                        return None;
                    };
                    properties
                        .into_iter()
                        .find(|(name, _)| name.iter().copied().eq("arguments".encode_utf16()))
                        .map(|(_, value)| value)
                })
                .unwrap_or_else(|| object([]));
            if !matches!(arguments, Value::Object(_)) || !arguments.is_json_value() {
                return failure(jsonrpc::INVALID_PARAMS, "Tool arguments must be an object");
            }
            return Action::Invoke {
                handler: tool.handler,
                arguments,
                context,
            };
        }
        failure(jsonrpc::METHOD_NOT_FOUND, "Method not found")
    }

    fn server_info(&self) -> Value {
        object([
            ("name", string(&self.options.name)),
            ("version", string(&self.options.version)),
        ])
    }

    fn capabilities(&self) -> Value {
        let mut common = Vec::new();
        if self.options.support_notifications {
            common.push(("listChanged".encode_utf16().collect(), Value::Bool(true)));
        }
        let mut resources = common.clone();
        if self.options.support_resource_subscriptions {
            resources.push(("subscribe".encode_utf16().collect(), Value::Bool(true)));
        }
        object([
            ("tools", Value::Object(common.clone())),
            ("prompts", Value::Object(common)),
            ("resources", Value::Object(resources)),
        ])
    }

    fn decorate_cacheable(&self, value: Value) -> Value {
        let Value::Object(mut properties) = value else {
            unreachable!("object result")
        };
        properties.extend([
            ("resultType".encode_utf16().collect(), string("complete")),
            (
                "_meta".encode_utf16().collect(),
                object([("io.modelcontextprotocol/serverInfo", self.server_info())]),
            ),
            ("ttlMs".encode_utf16().collect(), Value::Number(0.0)),
            ("cacheScope".encode_utf16().collect(), string("private")),
        ]);
        Value::Object(properties)
    }
}

fn select_protocol(method: &str, params: Option<&Value>) -> Result<bool, RpcError> {
    let missing = || {
        rpc_error(
            jsonrpc::INVALID_PARAMS,
            "Request metadata must include protocolVersion and clientCapabilities",
        )
    };
    let Some(metadata) = params.and_then(|value| value.get("_meta")) else {
        return if method == "server/discover" {
            Err(missing())
        } else {
            Ok(false)
        };
    };
    let Value::Object(_) = metadata else {
        return Err(missing());
    };
    if !is_valid_metadata(metadata) {
        return Err(rpc_error(
            jsonrpc::INVALID_PARAMS,
            "Invalid MCP metadata keys",
        ));
    }
    let version = metadata.get("io.modelcontextprotocol/protocolVersion");
    let capabilities = metadata.get("io.modelcontextprotocol/clientCapabilities");
    if version.is_none() && capabilities.is_none() && method != "server/discover" {
        return Ok(false);
    }
    if !matches!(version, Some(Value::String(_))) || !matches!(capabilities, Some(Value::Object(_)))
    {
        return Err(missing());
    }
    let modern = string_matches(version, MODERN_PROTOCOL_VERSION);
    if modern && !capabilities_are_valid(capabilities.expect("validated object capabilities")) {
        return Err(rpc_error(
            jsonrpc::INVALID_PARAMS,
            "Invalid MCP clientCapabilities",
        ));
    }
    if !modern
        && !SUPPORTED_PROTOCOL_VERSIONS
            .iter()
            .any(|supported| string_matches(version, supported))
    {
        return Err(RpcError {
            code: jsonrpc::UNSUPPORTED_PROTOCOL_VERSION,
            message: "Unsupported protocol version".into(),
            data: Some(object([
                ("requested", version.expect("validated version").clone()),
                (
                    "supported",
                    Value::Array(
                        SUPPORTED_PROTOCOL_VERSIONS
                            .iter()
                            .rev()
                            .map(|value| string(value))
                            .collect(),
                    ),
                ),
            ])),
        });
    }
    if modern
        && [
            "initialize",
            "notifications/initialized",
            "ping",
            "logging/setLevel",
            "resources/subscribe",
            "resources/unsubscribe",
            "notifications/roots/list_changed",
        ]
        .contains(&method)
    {
        return Err(rpc_error(jsonrpc::METHOD_NOT_FOUND, "Method not found"));
    }
    Ok(modern)
}

fn string_matches(value: Option<&Value>, expected: &str) -> bool {
    matches!(value, Some(Value::String(units)) if units.iter().copied().eq(expected.encode_utf16()))
}

fn capabilities_are_valid(value: &Value) -> bool {
    for name in [
        "roots",
        "sampling",
        "elicitation",
        "experimental",
        "extensions",
    ] {
        let Some(capability) = value.get(name) else {
            continue;
        };
        let Value::Object(properties) = capability else {
            return false;
        };
        let fields: &[&str] = match name {
            "sampling" => &["context", "tools"],
            "elicitation" => &["form", "url"],
            _ => &[],
        };
        for field in fields {
            if capability
                .get(field)
                .is_some_and(|value| !matches!(value, Value::Object(_)))
            {
                return false;
            }
        }
        if ["experimental", "extensions"].contains(&name) {
            for (key, value) in properties {
                if !matches!(value, Value::Object(_))
                    || (name == "extensions"
                        && (!key.contains(&(b'/' as u16)) || !is_valid_metadata_key(key)))
                {
                    return false;
                }
            }
        }
    }
    true
}

fn string(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn object<const N: usize>(properties: [(&str, Value); N]) -> Value {
    Value::Object(
        properties
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    )
}
fn rpc_error(code: i32, message: &str) -> RpcError {
    RpcError {
        code,
        message: message.into(),
        data: None,
    }
}
fn failure(code: i32, message: &str) -> Action {
    Action::Error(rpc_error(code, message))
}
