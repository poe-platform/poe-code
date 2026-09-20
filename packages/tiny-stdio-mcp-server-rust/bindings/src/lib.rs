use mcp_protocol_rust::{
    json::{Limits, Value},
    jsonrpc::{Id, RpcError},
};
use napi::{Error, bindgen_prelude::*};
use napi_derive::napi;
use std::{cell::RefCell, collections::HashMap};
use tiny_stdio_mcp_server_rust::{Action, Server, ServerOptions, Session};
use tiny_stdio_mcp_server_rust::{requests::RequestTracker, select_protocol};

#[path = "../../../mcp-protocol-rust/bindings/src/convert.rs"]
mod convert;
use convert::NativeJson;
mod input;
mod stdio;

#[napi(object)]
pub struct NativeServerOptions {
    pub name: String,
    pub version: String,
    pub support_notifications: Option<bool>,
    pub support_resource_subscriptions: Option<bool>,
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
                    name: options.name,
                    version: options.version,
                    support_notifications: options.support_notifications != Some(false),
                    support_resource_subscriptions: options.support_resource_subscriptions
                        != Some(false),
                }),
                sessions: HashMap::new(),
                next_session: 0,
                next_handler: 0,
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
        token.is_finite()
            && token.fract() == 0.0
            && (1.0..=9_007_199_254_740_991.0).contains(&token)
            && self.state.borrow_mut().requests.finish(token as u64)
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

    #[napi]
    pub fn set_tool(&self, env: Env, definition: Unknown<'_>, replace: bool) -> Result<u32> {
        // Proxy descriptor traps can reenter this addon. Finish all JS calls
        // before borrowing mutable state; the core never retains JS handles.
        let definition = input::read(&env, definition, input::Mode::Json)?
            .ok_or_else(|| Error::from_reason("Tool definition required"))?;
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
        Ok(id)
    }

    #[napi]
    pub fn remove_tool(&self, name: String) -> bool {
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
        use tiny_stdio_mcp_server_rust::wire::{LineMessage, parse_line};
        let (wire_id, notification, action) = match parse_line(&source, Limits::default()) {
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
                let action =
                    self.state
                        .borrow_mut()
                        .dispatch(id, &method, request.params, context_id)?;
                (wire_id, notification, action)
            }
        };
        Ok(NativeJson(object([
            ("id", wire_id.into_value()),
            ("isNotification", Value::Bool(notification)),
            ("action", action),
        ])))
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
            let token = match requests.begin(id, request_id, modern) {
                Ok(token) => token,
                Err(error) => return Ok(action_value(Action::Error(error))),
            };
            // JS receives numeric tokens. Do not narrow to u32 or silently lose
            // identity once IEEE-754's exact-integer range is exhausted.
            if token > 9_007_199_254_740_991 {
                requests.finish(token);
                return Err(Error::from_reason("Native request identifier exhausted"));
            }
            let action = server.dispatch(session, method, params);
            if !matches!(action, Action::Invoke { .. }) {
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
        Action::Reply(value) => object([("type", string("reply")), ("value", value)]),
        Action::Error(RpcError {
            code,
            message,
            data,
        }) => {
            let mut error = vec![
                ("code".encode_utf16().collect(), Value::Number(code as f64)),
                ("message".encode_utf16().collect(), string(&message)),
            ];
            if let Some(data) = data {
                error.push(("data".encode_utf16().collect(), data));
            }
            object([("type", string("error")), ("value", Value::Object(error))])
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
        ]),
    }
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
