use mcp_protocol_rust::{
    json::{Limits, Value},
    jsonrpc::{Id, RpcError},
};
use napi::{Error, bindgen_prelude::*};
use napi_derive::napi;
use std::{cell::RefCell, collections::HashMap, sync::Arc};
use tiny_stdio_mcp_server_rust::features::{FeatureKind, RegistrationKind};
use tiny_stdio_mcp_server_rust::{Action, Server, ServerOptions, Session};
use tiny_stdio_mcp_server_rust::{requests::RequestTracker, select_protocol};

#[path = "../../../mcp-protocol-rust/bindings/src/convert.rs"]
mod convert;
use convert::NativeJson;
mod input;
mod stdio;
mod uri_template;

#[napi(ts_return_type = "unknown")]
pub fn define_schema(env: Env, source: Unknown<'_>) -> Result<NativeJson> {
    let definition = input::read(&env, source, input::Mode::Json)?
        .ok_or_else(|| Error::from_reason("Schema definition must be an object"))?;
    tiny_stdio_mcp_server_rust::schema::define_schema(definition)
        .map(NativeJson)
        .map_err(Error::from_reason)
}

#[napi]
pub fn validate_protocol_value(env: Env, definition: String, source: Unknown<'_>) -> bool {
    input::read(&env, source, input::Mode::Json)
        .ok()
        .flatten()
        .is_some_and(|value| {
            tiny_stdio_mcp_server_rust::protocol::validate_definition(&definition, &value)
        })
}

#[napi(object)]
pub struct NativeServerOptions {
    pub name: Utf16String,
    pub version: Utf16String,
    pub support_notifications: Option<bool>,
    pub support_resource_subscriptions: Option<bool>,
    pub validate_tool_arguments: Option<bool>,
    pub max_active_requests: Option<f64>,
    pub max_stdio_line_bytes: Option<f64>,
    pub max_pending_stdio_messages: Option<f64>,
    pub max_stdio_output_bytes: Option<f64>,
}

#[napi(object)]
#[derive(Clone)]
pub struct StdioOptions {
    pub max_line_bytes: f64,
    pub max_pending_messages: f64,
    pub max_output_bytes: f64,
}

#[napi]
pub struct NativeServer {
    state: RefCell<ServerState>,
}

struct ServerState {
    server: Server,
    sessions: HashMap<u32, Session>,
    next_session: u32,
    next_handler: u32,
    requests: RequestTracker,
    stdio: StdioOptions,
    outputs: HashMap<u64, Arc<tiny_stdio_mcp_server_rust::tool_result::ToolOutput>>,
    listens: HashMap<u64, u32>,
    invocations: HashMap<u64, (String, Value)>,
}

#[napi]
impl NativeServer {
    #[napi(constructor)]
    pub fn new(options: NativeServerOptions) -> Result<Self> {
        let limit = options.max_active_requests.unwrap_or(128.0);
        if !limit.is_finite()
            || limit.fract() != 0.0
            || !(1.0..=9_007_199_254_740_991.0).contains(&limit)
        {
            return Err(Error::from_reason(
                "maxActiveRequests must be a safe integer greater than or equal to 1.",
            ));
        }
        Ok(Self {
            state: RefCell::new(ServerState {
                server: Server::new(ServerOptions {
                    name: options.name.to_vec(),
                    version: options.version.to_vec(),
                    support_notifications: options.support_notifications != Some(false),
                    support_resource_subscriptions: options.support_resource_subscriptions
                        != Some(false),
                    validate_tool_arguments: options.validate_tool_arguments != Some(false),
                }),
                sessions: HashMap::new(),
                next_session: 0,
                next_handler: 0,
                outputs: HashMap::new(),
                listens: HashMap::new(),
                invocations: HashMap::new(),
                requests: RequestTracker::new(limit as usize).map_err(Error::from_reason)?,
                stdio: StdioOptions {
                    max_line_bytes: capacity(
                        options.max_stdio_line_bytes,
                        "maxStdioLineBytes",
                        1024.0 * 1024.0,
                    )?,
                    max_pending_messages: capacity(
                        options.max_pending_stdio_messages,
                        "maxPendingStdioMessages",
                        128.0,
                    )?,
                    max_output_bytes: capacity(
                        options.max_stdio_output_bytes,
                        "maxStdioOutputBytes",
                        1024.0 * 1024.0,
                    )?,
                },
            }),
        })
    }

    #[napi]
    pub fn create_session(&self) -> Result<u32> {
        let mut state = self.state.borrow_mut();
        let id = state
            .next_session
            .checked_add(1)
            .ok_or_else(|| Error::from_reason("Session identifier exhausted"))?;
        state.next_session = id;
        state.sessions.insert(id, Session::default());
        Ok(id)
    }

    #[napi]
    pub fn close_session(&self, id: u32) -> bool {
        if let Some(mut session) = self.state.borrow_mut().sessions.remove(&id) {
            session.close();
            true
        } else {
            false
        }
    }

    #[napi(getter)]
    pub fn session_count(&self) -> u32 {
        self.state.borrow().sessions.len() as u32
    }

    #[napi]
    pub fn can_notify(&self, id: u32, modern: bool) -> bool {
        self.state
            .borrow()
            .sessions
            .get(&id)
            .is_some_and(|session| session.can_notify(modern))
    }

    #[napi(
        ts_return_type = "{ notification: unknown; sessions: number[]; subscriptions: { session: number; notification: unknown }[] } | null"
    )]
    pub fn notification(&self, kind: String, uri: Option<Utf16String>) -> Result<NativeJson> {
        use tiny_stdio_mcp_server_rust::notifications::NotificationKind;
        let kind = match kind.as_str() {
            "tools" => NotificationKind::ToolsChanged,
            "prompts" => NotificationKind::PromptsChanged,
            "resources" => NotificationKind::ResourcesChanged,
            "resource" => NotificationKind::ResourceUpdated(
                uri.ok_or_else(|| Error::from_reason("Resource URI required"))?
                    .to_vec(),
            ),
            _ => return Err(Error::from_reason("Unknown notification kind")),
        };
        let state = self.state.borrow();
        Ok(NativeJson(
            state
                .server
                .notification(
                    kind,
                    state.sessions.iter().map(|(id, session)| (*id, session)),
                )
                .map_or(Value::Null, |notification| {
                    object([
                        ("notification", notification.value),
                        (
                            "sessions",
                            Value::Array(
                                notification
                                    .sessions
                                    .into_iter()
                                    .map(|id| Value::Number(id as f64))
                                    .collect(),
                            ),
                        ),
                        (
                            "subscriptions",
                            Value::Array(
                                notification
                                    .subscriptions
                                    .into_iter()
                                    .map(|delivery| {
                                        object([
                                            ("session", Value::Number(delivery.session as f64)),
                                            ("notification", delivery.notification),
                                        ])
                                    })
                                    .collect(),
                            ),
                        ),
                    ])
                }),
        ))
    }

    #[napi(getter)]
    pub fn stdio_options(&self) -> StdioOptions {
        self.state.borrow().stdio.clone()
    }

    #[napi(getter)]
    pub fn active_request_count(&self) -> u32 {
        self.state.borrow().requests.active_count() as u32
    }

    #[napi]
    pub fn finish_request(&self, token: f64) -> bool {
        if !token.is_finite()
            || token.fract() != 0.0
            || !(1.0..=9_007_199_254_740_991.0).contains(&token)
        {
            return false;
        }
        let mut state = self.state.borrow_mut();
        state.outputs.remove(&(token as u64));
        state.invocations.remove(&(token as u64));
        if let Some(id) = state.listens.remove(&(token as u64))
            && let Some(session) = state.sessions.get_mut(&id)
        {
            session.finish_subscription(token as u64);
        }
        state.requests.finish(token as u64)
    }

    #[napi]
    pub fn acknowledge_subscription(&self, id: u32, token: f64) -> bool {
        if !token.is_finite()
            || token.fract() != 0.0
            || !(1.0..=9_007_199_254_740_991.0).contains(&token)
        {
            return false;
        }
        self.state
            .borrow_mut()
            .sessions
            .get_mut(&id)
            .is_some_and(|session| session.acknowledge_subscription(token as u64))
    }

    #[napi]
    pub fn cancel_subscription(&self, id: u32, token: f64) -> bool {
        if !token.is_finite()
            || token.fract() != 0.0
            || !(1.0..=9_007_199_254_740_991.0).contains(&token)
        {
            return false;
        }
        self.state
            .borrow_mut()
            .sessions
            .get_mut(&id)
            .is_some_and(|session| session.finish_subscription(token as u64))
    }

    #[napi(ts_return_type = "unknown")]
    pub fn complete_input_required(
        &self,
        env: Env,
        source: Unknown<'_>,
        token: f64,
    ) -> Result<NativeJson> {
        // Conversion can reenter JS via proxy descriptor traps; borrow only
        // after ingress completes, and reject non-JSON requirements as RPC errors.
        let value = input::read(&env, source, input::Mode::Json);
        let invalid = || RpcError {
            code: -32603,
            message: "Invalid MCP input_required result".into(),
            data: None,
        };
        let result = match value {
            Ok(Some(value)) => {
                let state = self.state.borrow();
                match state.invocations.get(&(token as u64)) {
                    Some((method, capabilities)) => {
                        state
                            .server
                            .decorate_invocation_result(method, value, capabilities)
                    }
                    None => Err(invalid()),
                }
            }
            _ => Err(invalid()),
        };
        Ok(NativeJson(match result {
            Ok(result) => object([("result", result)]),
            Err(error) => object([("error", rpc_error_value(error))]),
        }))
    }

    #[napi(ts_return_type = "unknown")]
    pub fn complete_tool(
        &self,
        env: Env,
        source: Unknown<'_>,
        modern: bool,
        token: f64,
    ) -> Result<NativeJson, String> {
        use tiny_stdio_mcp_server_rust::tool_result::ResultError;
        let value = input::read(&env, source, input::Mode::Tool)
            .map_err(|error| Error::new("GenericFailure".to_owned(), error.reason))?;
        if modern && value.as_ref().and_then(|value| value.get("resultType")).is_some_and(|value| matches!(value, Value::String(units) if units.iter().copied().eq("input_required".encode_utf16()))) {
            return Ok(NativeJson(object([("error", rpc_error_value(RpcError { code: -32603, message: "Invalid MCP input_required result".into(), data: None }))])));
        }
        let output = self
            .state
            .borrow()
            .outputs
            .get(&(token as u64))
            .cloned()
            .ok_or_else(|| {
                Error::new(
                    "GenericFailure".to_owned(),
                    "Tool invocation no longer active",
                )
            })?;
        match output.normalize(value, modern) {
            Ok(result) => {
                let result = if modern {
                    match self.state.borrow().server.decorate_result(result) {
                        Ok(result) => result,
                        Err(message) => {
                            return Ok(NativeJson(object([(
                                "error",
                                rpc_error_value(RpcError {
                                    code: -32603,
                                    message,
                                    data: None,
                                }),
                            )])));
                        }
                    }
                } else {
                    result
                };
                Ok(NativeJson(object([("result", result)])))
            }
            Err(ResultError::Rpc(error)) => {
                Ok(NativeJson(object([("error", rpc_error_value(error))])))
            }
            Err(ResultError::Content(message)) => {
                Err(Error::new("GenericFailure".to_owned(), message))
            }
        }
    }

    #[napi(ts_return_type = "unknown")]
    pub fn normalize_result(
        &self,
        env: Env,
        source: Unknown<'_>,
        modern: Option<bool>,
    ) -> Result<NativeJson, String> {
        let value = input::read(&env, source, input::Mode::Tool)
            .map_err(|error| Error::new("GenericFailure".to_owned(), error.reason))?;
        if modern == Some(true) && value.as_ref().and_then(|value| value.get("resultType")).is_some_and(|value| matches!(value, Value::String(units) if units.iter().copied().eq("input_required".encode_utf16()))) {
            return Err(Error::new("InvalidMcpResult".to_owned(), "Invalid MCP input_required result"));
        }
        let value =
            tiny_stdio_mcp_server_rust::content::normalize_result(value, modern == Some(true))
                .map_err(|message| Error::new("GenericFailure".to_owned(), message))?;
        Ok(NativeJson(if modern == Some(true) {
            self.state
                .borrow()
                .server
                .decorate_result(value)
                .map_err(|message| Error::new("InvalidMcpResult".to_owned(), message))?
        } else {
            value
        }))
    }

    #[napi(ts_return_type = "{ handler: number; name: string }")]
    pub fn set_tool(&self, env: Env, definition: Unknown<'_>, replace: bool) -> Result<NativeJson> {
        // Proxy descriptor traps can reenter this addon. Finish all JS calls
        // before borrowing mutable state; the core never retains JS handles.
        let definition = input::read(&env, definition, input::Mode::Json)?
            .ok_or_else(|| Error::from_reason("Tool definition required"))?;
        let name = definition.get("name").cloned().unwrap_or(Value::Null);
        let mut state = self.state.borrow_mut();
        let id = state
            .next_handler
            .checked_add(1)
            .ok_or_else(|| Error::from_reason("Handler identifier exhausted"))?;
        state
            .server
            .set_tool(definition, id as u64, replace)
            .map_err(Error::from_reason)?;
        state.next_handler = id;
        Ok(NativeJson(object([
            ("handler", Value::Number(id as f64)),
            ("name", name),
        ])))
    }

    #[napi(ts_return_type = "{ handler: number; name: string }")]
    pub fn set_feature(
        &self,
        env: Env,
        kind: String,
        definition: Unknown<'_>,
    ) -> Result<NativeJson> {
        let kind = registration_kind(&kind)?;
        let definition = input::read(&env, definition, input::Mode::Json)?
            .ok_or_else(|| Error::from_reason("Feature definition required"))?;
        let mut state = self.state.borrow_mut();
        let id = state
            .next_handler
            .checked_add(1)
            .ok_or_else(|| Error::from_reason("Handler identifier exhausted"))?;
        let name = state
            .server
            .features
            .register(kind, definition, u64::from(id))
            .map_err(Error::from_reason)?;
        state.next_handler = id;
        Ok(NativeJson(object([
            ("handler", Value::Number(f64::from(id))),
            ("name", Value::String(name)),
        ])))
    }

    #[napi]
    pub fn remove_feature(&self, kind: String, name: Utf16String) -> Result<Option<f64>> {
        Ok(self
            .state
            .borrow_mut()
            .server
            .features
            .remove(registration_kind(&kind)?, &name)
            .map(|handler| handler as f64))
    }

    #[napi(ts_return_type = "unknown")]
    pub fn complete_feature(
        &self,
        env: Env,
        source: Unknown<'_>,
        modern: bool,
        kind: String,
        allow_resource_links: bool,
    ) -> Result<NativeJson> {
        let kind = match kind.as_str() {
            "prompt" => FeatureKind::Prompt {
                allow_resource_links,
            },
            "resource" => FeatureKind::Resource,
            "custom" => FeatureKind::Custom,
            _ => return Err(Error::from_reason("Unknown handler kind")),
        };
        let result = input::read(&env, source, input::Mode::Json)?;
        let result = match tiny_stdio_mcp_server_rust::features::validate_result(kind, result) {
            Ok(result) => result,
            Err(error) => return Ok(NativeJson(object([("error", rpc_error_value(error))]))),
        };
        let result = if modern {
            let decorated = match result {
                Some(result) => {
                    if kind == FeatureKind::Resource {
                        self.state.borrow().server.decorate_resource_result(result)
                    } else {
                        self.state.borrow().server.decorate_result(result)
                    }
                }
                None => Err("MCP result must be an object".into()),
            };
            match decorated {
                Ok(result) => Some(result),
                Err(message) => {
                    return Ok(NativeJson(object([(
                        "error",
                        rpc_error_value(RpcError {
                            code: -32603,
                            message,
                            data: None,
                        }),
                    )])));
                }
            }
        } else {
            result
        };
        Ok(NativeJson(Value::Object(
            result
                .into_iter()
                .map(|result| ("result".encode_utf16().collect(), result))
                .collect(),
        )))
    }

    #[napi]
    pub fn remove_tool(&self, name: Utf16String) -> bool {
        self.state.borrow_mut().server.remove_tool(&name)
    }

    #[napi(ts_return_type = "unknown")]
    pub fn dispatch(
        &self,
        env: Env,
        id: u32,
        method: String,
        source: Unknown<'_>,
        context: Option<Object<'_>>,
    ) -> Result<NativeJson> {
        if !self.state.borrow().sessions.contains_key(&id) {
            return Ok(NativeJson(object([("type", string("none"))])));
        }
        let params = input::read(&env, source, input::Mode::Json)?;
        let request_id = context
            .map(|context| {
                context
                    .get_named_property::<Unknown>("requestId")
                    .and_then(input::read_id)
            })
            .transpose()?
            .flatten();
        self.state
            .borrow_mut()
            .dispatch(id, &method, params, request_id)
            .map(NativeJson)
    }

    #[napi(ts_return_type = "unknown")]
    pub fn dispatch_line(&self, id: u32, source: Utf16String) -> Result<NativeJson> {
        use tiny_stdio_mcp_server_rust::wire::parse_line;
        self.state
            .borrow_mut()
            .dispatch_wire(id, parse_line(&source, Limits::default()))
            .map(NativeJson)
    }

    #[napi(ts_return_type = "unknown")]
    pub fn dispatch_sdk(
        &self,
        env: Env,
        id: u32,
        method: Utf16String,
        source: Unknown<'_>,
        request_id: Unknown<'_>,
    ) -> Result<NativeJson> {
        let params = input::read(&env, source, input::Mode::Json)?;
        let request_id = input::read_id(request_id)?;
        let message =
            tiny_stdio_mcp_server_rust::wire::admit(mcp_protocol_rust::jsonrpc::Request {
                id: request_id,
                method: method.to_vec(),
                params,
            });
        self.state
            .borrow_mut()
            .dispatch_wire(id, message)
            .map(NativeJson)
    }
}

impl ServerState {
    fn dispatch_wire(
        &mut self,
        id: u32,
        message: tiny_stdio_mcp_server_rust::wire::LineMessage,
    ) -> Result<Value> {
        use tiny_stdio_mcp_server_rust::wire::LineMessage;
        let (wire_id, notification, action) = match message {
            LineMessage::Ignore => (Id::Null, true, object([("type", string("none"))])),
            LineMessage::Error { id, error } => (id, false, action_value(Action::Error(error))),
            LineMessage::Dispatch(request) => {
                let notification = request.id.is_none();
                let wire_id = request.id.unwrap_or(Id::Null);
                let context_id = if matches!(wire_id, Id::Null) {
                    None
                } else {
                    Some(wire_id.clone())
                };
                let method = String::from_utf16_lossy(&request.method);
                let action = self.dispatch(id, &method, request.params, context_id)?;
                (wire_id, notification, action)
            }
        };
        Ok(object([
            ("id", wire_id.into_value()),
            ("isNotification", Value::Bool(notification)),
            ("action", action),
        ]))
    }
}

impl ServerState {
    fn dispatch(
        &mut self,
        id: u32,
        method: &str,
        params: Option<Value>,
        request_id: Option<mcp_protocol_rust::jsonrpc::Id>,
    ) -> Result<Value> {
        let modern = if method == "notifications/cancelled" {
            false
        } else {
            match select_protocol(method, params.as_ref()) {
                Ok(modern) => modern,
                Err(error) => return Ok(action_value(Action::Error(error))),
            }
        };
        let (action, token) = {
            let ServerState {
                server,
                sessions,
                requests,
                outputs,
                listens,
                invocations,
                ..
            } = self;
            // A descriptor trap may have closed the session during conversion.
            let Some(session) = sessions.get_mut(&id) else {
                return Ok(object([("type", string("none"))]));
            };
            if method == "notifications/cancelled" {
                let token = match params.as_ref().and_then(|params| params.get("requestId")) {
                    Some(Value::String(value)) => {
                        requests.token(id, &mcp_protocol_rust::jsonrpc::Id::String(value.clone()))
                    }
                    Some(Value::Number(value)) => {
                        requests.token(id, &mcp_protocol_rust::jsonrpc::Id::Number(*value))
                    }
                    _ => None,
                };
                return Ok(object([
                    ("type", string("cancel")),
                    (
                        "token",
                        token.map_or(Value::Null, |token| Value::Number(token as f64)),
                    ),
                ]));
            }
            let token = match requests.begin(id, request_id.clone(), modern) {
                Ok(token) => token,
                Err(error) => return Ok(action_value(Action::Error(error))),
            };
            // JS receives numeric tokens. Do not narrow to u32 or silently lose
            // identity once IEEE-754's exact-integer range is exhausted.
            if token > 9_007_199_254_740_991 {
                requests.finish(token);
                return Err(Error::from_reason("Native request identifier exhausted"));
            }
            let action = if modern && method == "subscriptions/listen" {
                server.listen(
                    session,
                    token,
                    request_id,
                    params.and_then(|params| params.get("notifications").cloned()),
                )
            } else {
                server.dispatch(session, method, params)
            };
            if modern
                && let Action::Invoke { context, .. } | Action::InvokeFeature { context, .. } =
                    &action
            {
                invocations.insert(
                    token,
                    (
                        method.to_owned(),
                        context
                            .get("clientCapabilities")
                            .cloned()
                            .unwrap_or_else(|| object([])),
                    ),
                );
            }
            if let Action::Invoke { handler, .. } = &action {
                outputs.insert(
                    token,
                    server
                        .output_contract(*handler)
                        .expect("admitted tool output contract"),
                );
            } else if matches!(action, Action::Listen { .. }) {
                listens.insert(token, id);
            } else if !matches!(action, Action::InvokeFeature { .. }) {
                requests.finish(token);
            }
            (action, token)
        };
        let mut value = action_value(action);
        if let Value::Object(fields) = &mut value {
            fields.push((
                "token".encode_utf16().collect(),
                Value::Number(token as f64),
            ));
            fields.push(("modern".encode_utf16().collect(), Value::Bool(modern)));
        }
        Ok(value)
    }
}

fn action_value(action: Action) -> Value {
    match action {
        Action::Listen { acknowledgment } => object([
            ("type", string("listen")),
            ("acknowledgment", acknowledgment),
        ]),
        Action::Reply(value) => object([("type", string("reply")), ("value", value)]),
        Action::Error(error) => {
            object([("type", string("error")), ("value", rpc_error_value(error))])
        }
        Action::NoReply => object([("type", string("none"))]),
        Action::Invoke {
            handler,
            arguments,
            context,
        } => object([
            ("type", string("invoke")),
            ("handler", Value::Number(handler as f64)),
            ("arguments", arguments),
            ("context", context),
            ("handlerKind", string("tool")),
        ]),
        Action::InvokeFeature {
            handler,
            arguments,
            context,
            kind,
        } => {
            let (label, allow_links) = match kind {
                FeatureKind::Prompt {
                    allow_resource_links,
                } => ("prompt", allow_resource_links),
                FeatureKind::Resource => ("resource", false),
                FeatureKind::Custom => ("custom", false),
            };
            let mut fields = vec![
                ("type".encode_utf16().collect(), string("invoke")),
                (
                    "handler".encode_utf16().collect(),
                    Value::Number(handler as f64),
                ),
                ("context".encode_utf16().collect(), context),
                ("handlerKind".encode_utf16().collect(), string(label)),
                (
                    "allowResourceLinks".encode_utf16().collect(),
                    Value::Bool(allow_links),
                ),
            ];
            if let Some(arguments) = arguments {
                fields.push(("arguments".encode_utf16().collect(), arguments));
            }
            Value::Object(fields)
        }
    }
}

fn registration_kind(kind: &str) -> Result<RegistrationKind> {
    match kind {
        "prompt" => Ok(RegistrationKind::Prompt),
        "resource" => Ok(RegistrationKind::Resource),
        "resourceTemplate" => Ok(RegistrationKind::ResourceTemplate),
        "method" => Ok(RegistrationKind::Method),
        _ => Err(Error::from_reason("Unknown feature registration kind")),
    }
}

fn rpc_error_value(error: RpcError) -> Value {
    let mut fields = vec![
        (
            "code".encode_utf16().collect(),
            Value::Number(error.code as f64),
        ),
        ("message".encode_utf16().collect(), string(&error.message)),
    ];
    if let Some(data) = error.data {
        fields.push(("data".encode_utf16().collect(), data));
    }
    Value::Object(fields)
}

fn string(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}

fn capacity(value: Option<f64>, name: &str, default: f64) -> Result<f64> {
    let value = value.unwrap_or(default);
    if !value.is_finite()
        || value.fract() != 0.0
        || !(1.0..=9_007_199_254_740_991.0).contains(&value)
    {
        return Err(Error::from_reason(format!(
            "{name} must be a safe integer greater than or equal to 1."
        )));
    }
    Ok(value)
}
fn object<const N: usize>(properties: [(&str, Value); N]) -> Value {
    Value::Object(
        properties
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    )
}
