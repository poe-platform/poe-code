use mcp_protocol_rust::{json::Value, jsonrpc::RpcError};
use napi::{Error, bindgen_prelude::*};
use napi_derive::napi;
use std::{cell::RefCell, collections::HashMap};
use tiny_stdio_mcp_server_rust::{Action, Server, ServerOptions, Session};

#[path = "../../../mcp-protocol-rust/bindings/src/convert.rs"]
mod convert;
use convert::NativeJson;
mod input;

#[napi(object)]
pub struct NativeServerOptions {
    pub name: String,
    pub version: String,
    pub support_notifications: Option<bool>,
    pub support_resource_subscriptions: Option<bool>,
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
}

#[napi]
impl NativeServer {
    #[napi(constructor)]
    pub fn new(options: NativeServerOptions) -> Self {
        Self {
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
            }),
        }
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

    #[napi(ts_return_type = "unknown")]
    pub fn normalize_result(&self, env: Env, source: Unknown<'_>) -> Result<NativeJson> {
        let value = input::read(&env, source, input::Mode::Tool)?;
        tiny_stdio_mcp_server_rust::content::normalize_result(value)
            .map(NativeJson)
            .map_err(Error::from_reason)
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
    ) -> Result<NativeJson> {
        if !self.state.borrow().sessions.contains_key(&id) {
            return Ok(NativeJson(object([("type", string("none"))])));
        }
        let params = input::read(&env, source, input::Mode::Json)?;
        let action = {
            let mut state = self.state.borrow_mut();
            let ServerState {
                server, sessions, ..
            } = &mut *state;
            // A descriptor trap may have closed the session during conversion.
            let Some(session) = sessions.get_mut(&id) else {
                return Ok(NativeJson(object([("type", string("none"))])));
            };
            server.dispatch(session, &method, params)
        };
        Ok(NativeJson(match action {
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
        }))
    }
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
