use napi::bindgen_prelude::*;
use napi_derive::napi;
#[path = "../../../mcp-protocol-rust/bindings/src/convert.rs"]
mod convert;
#[napi]
pub fn parse_json_rpc_message(line: Utf16String) -> convert::NativeJson {
    convert::NativeJson(tiny_mcp_client_rust::messages::parse_message(line.as_ref()).into_value())
}

use mcp_protocol_rust::json::{self, Value};
use std::cell::RefCell;
use tiny_mcp_client_rust::layer::{Event, LayerError, MessageLayer};
#[path = "../../../mcp-protocol-rust/bindings/src/json_input.rs"]
#[expect(
    dead_code,
    reason = "shared ingress also includes tool result conversion"
)]
mod input;

#[napi]
pub struct NativeMessageLayer {
    state: RefCell<MessageLayer>,
}
#[napi]
impl NativeMessageLayer {
    #[napi(constructor)]
    pub fn new(limit: f64) -> Result<Self> {
        if !limit.is_finite()
            || limit.fract() != 0.0
            || !(1.0..=9_007_199_254_740_991.0).contains(&limit)
        {
            return Err(napi::Error::from_reason(
                "maxConcurrentRequests must be a positive safe integer",
            ));
        }
        Ok(Self {
            state: RefCell::new(
                MessageLayer::new(limit as usize)
                    .map_err(|error| napi::Error::from_reason(error.message))?,
            ),
        })
    }
    #[napi]
    pub fn begin_exchange(&self) -> Result<f64> {
        self.state
            .borrow_mut()
            .begin_exchange()
            .map(|token| token as f64)
            .map_err(|error| napi::Error::from_reason(error.message))
    }
    #[napi]
    pub fn finish_exchange(&self, token: f64) -> bool {
        self.state.borrow_mut().finish_exchange(token as u64)
    }
    #[napi]
    pub fn register_request(&self, method: Utf16String) {
        self.state.borrow_mut().register_request(method.to_vec());
    }
    #[napi]
    pub fn set_modern(&self, modern: bool) {
        self.state.borrow_mut().set_modern(modern);
    }
    #[napi]
    pub fn prepare_request(
        &self,
        env: Env,
        token: f64,
        method: Utf16String,
        params: Unknown<'_>,
        metadata: Unknown<'_>,
    ) -> convert::NativeJson {
        let params = match input::read(&env, params, input::Mode::Json) {
            Ok(params) => params,
            Err(_) => {
                return layer_error(LayerError {
                    code: Some(-32602),
                    message: "Request params must contain only JSON values",
                });
            }
        };
        let metadata = match input::read(&env, metadata, input::Mode::Json) {
            Ok(metadata) => metadata,
            Err(_) => {
                return layer_error(LayerError {
                    code: Some(-32602),
                    message: "Invalid request metadata",
                });
            }
        };
        match self.state.borrow_mut().prepare_request(
            token as u64,
            method.to_vec(),
            params,
            metadata,
        ) {
            Ok(request) => convert::NativeJson(object(vec![
                ("id", request.get("id").expect("request ID").clone()),
                ("line", text(&(json::stringify(&request) + "\n"))),
            ])),
            Err(error) => layer_error(error),
        }
    }
    #[napi]
    pub fn notification(
        &self,
        env: Env,
        method: Utf16String,
        params: Unknown<'_>,
    ) -> convert::NativeJson {
        let params = match input::read(&env, params, input::Mode::Json) {
            Ok(params) => params,
            Err(_) => {
                return layer_error(LayerError {
                    code: Some(-32602),
                    message: "Notification params must contain only JSON values",
                });
            }
        };
        match self.state.borrow().notification(method.to_vec(), params) {
            Ok(message) => convert::NativeJson(object(vec![(
                "line",
                text(&(json::stringify(&message) + "\n")),
            )])),
            Err(error) => layer_error(error),
        }
    }
    #[napi]
    pub fn feed(&self, line: Utf16String) -> Result<()> {
        self.state
            .borrow_mut()
            .feed(&line)
            .map_err(|error| napi::Error::from_reason(error.message))
    }
    #[napi]
    pub fn next_event(&self) -> Option<convert::NativeJson> {
        self.state.borrow_mut().next_event().map(|event| {
            convert::NativeJson(match event {
                Event::Write(message) => object(vec![
                    ("type", text("write")),
                    ("line", text(&(json::stringify(&message) + "\n"))),
                ]),
                Event::Settle { id, result, error } => {
                    let mut fields =
                        vec![("type", text("settle")), ("id", Value::Number(id as f64))];
                    if let Some(result) = result {
                        fields.push(("result", result));
                    }
                    if let Some(error) = error {
                        fields.push(("error", error));
                    }
                    object(fields)
                }
                Event::Invoke {
                    token,
                    id,
                    method,
                    params,
                } => {
                    let mut fields = vec![
                        ("type", text("invoke")),
                        ("token", Value::Number(token as f64)),
                        ("id", id),
                        ("method", Value::String(method)),
                    ];
                    if let Some(params) = params {
                        fields.push(("params", params));
                    }
                    object(fields)
                }
                Event::Cancel { token, reason } => object(vec![
                    ("type", text("cancel")),
                    ("token", Value::Number(token as f64)),
                    ("reason", Value::String(reason)),
                ]),
                Event::Notification { method, params } => {
                    let mut fields = vec![
                        ("type", text("notification")),
                        ("method", Value::String(method)),
                    ];
                    if let Some(params) = params {
                        fields.push(("params", params));
                    }
                    object(fields)
                }
            })
        })
    }
    #[napi]
    pub fn cancel_request(&self, id: f64) -> bool {
        id.is_finite()
            && id >= 1.0
            && id.fract() == 0.0
            && self.state.borrow_mut().cancel_request(id as u64)
    }
    #[napi]
    pub fn validate_incoming(
        &self,
        env: Env,
        token: f64,
        params: Unknown<'_>,
    ) -> Result<Option<Utf16String>> {
        let params = input::read(&env, params, input::Mode::Json)?;
        Ok(self
            .state
            .borrow()
            .validate_incoming(token as u64, params)
            .map(|reply| {
                (json::stringify(&reply) + "\n")
                    .encode_utf16()
                    .collect::<Vec<_>>()
                    .into()
            }))
    }
    #[napi]
    pub fn complete_incoming(
        &self,
        env: Env,
        token: f64,
        result: Unknown<'_>,
        failed: bool,
    ) -> Result<Option<Utf16String>> {
        let value = input::read(&env, result, input::Mode::Json)
            .map_err(|_| napi::Error::from_reason("Response result must contain only JSON values"))?
            .ok_or_else(|| {
                napi::Error::from_reason("Response result must contain only JSON values")
            })?;
        let result = if failed { Err(value) } else { Ok(value) };
        Ok(self
            .state
            .borrow()
            .complete_incoming(token as u64, result)
            .map(|reply| {
                (json::stringify(&reply) + "\n")
                    .encode_utf16()
                    .collect::<Vec<_>>()
                    .into()
            }))
    }
    #[napi]
    pub fn finish_incoming(&self, token: f64) -> bool {
        self.state.borrow_mut().finish_incoming(token as u64)
    }
    #[napi]
    pub fn dispose(&self) {
        self.state.borrow_mut().dispose();
    }
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(name, value)| (name.encode_utf16().collect(), value))
            .collect(),
    )
}
fn text(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn layer_error(error: LayerError) -> convert::NativeJson {
    let mut fields = vec![("message", text(error.message))];
    if let Some(code) = error.code {
        fields.push(("code", Value::Number(code.into())));
    }
    convert::NativeJson(object(vec![("error", object(fields))]))
}

use tiny_mcp_client_rust::retries::{ResultAction, RetryState};
#[napi]
pub struct NativeRetryState {
    state: RefCell<RetryState>,
}
#[napi]
impl NativeRetryState {
    #[napi(constructor)]
    pub fn new(env: Env, method: String, params: Unknown<'_>) -> Result<Self> {
        let params = input::read(&env, params, input::Mode::Json).map_err(|_| {
            napi::Error::from_reason("Request params must contain only JSON values")
        })?;
        if params
            .as_ref()
            .is_some_and(|params| !params.is_json_value())
        {
            return Err(napi::Error::from_reason(
                "Request params must contain only JSON values",
            ));
        }
        Ok(Self {
            state: RefCell::new(RetryState::new(method, params)),
        })
    }
    #[napi]
    pub fn process_result(
        &self,
        env: Env,
        result: Unknown<'_>,
        metadata: Unknown<'_>,
        handlers: Vec<String>,
    ) -> Result<convert::NativeJson> {
        let result = input::read(&env, result, input::Mode::Json)?.unwrap_or(Value::Null);
        let metadata = input::read(&env, metadata, input::Mode::Json)?
            .unwrap_or_else(|| Value::Object(vec![]));
        let capabilities = metadata
            .get("io.modelcontextprotocol/clientCapabilities")
            .cloned()
            .unwrap_or_else(|| Value::Object(vec![]));
        Ok(
            match self
                .state
                .borrow_mut()
                .process_result(result, &capabilities, &handlers)
            {
                Ok(ResultAction::Complete(result)) => convert::NativeJson(object(vec![
                    ("type", text("complete")),
                    ("result", result),
                ])),
                Ok(ResultAction::Inputs(requests)) => convert::NativeJson(object(vec![
                    ("type", text("inputs")),
                    (
                        "requests",
                        Value::Array(
                            requests
                                .into_iter()
                                .map(|request| {
                                    let mut fields = vec![
                                        ("key", Value::String(request.key)),
                                        ("method", text(&request.method)),
                                    ];
                                    if let Some(params) = request.params {
                                        fields.push(("params", params));
                                    }
                                    object(fields)
                                })
                                .collect(),
                        ),
                    ),
                ])),
                Err(error) => rpc_error(error),
            },
        )
    }
    #[napi]
    pub fn record_response(
        &self,
        env: Env,
        key: Utf16String,
        method: String,
        response: Unknown<'_>,
    ) -> convert::NativeJson {
        let response = match input::read(&env, response, input::Mode::Json) {
            Ok(Some(response)) => response,
            _ => {
                return rpc_error(mcp_protocol_rust::jsonrpc::RpcError {
                    code: -32600,
                    message: "Invalid MCP input response".into(),
                    data: None,
                });
            }
        };
        match self
            .state
            .borrow_mut()
            .record_response(key.to_vec(), &method, response)
        {
            Ok(()) => convert::NativeJson(object(vec![])),
            Err(error) => rpc_error(error),
        }
    }
    #[napi]
    pub fn next_params(&self) -> convert::NativeJson {
        convert::NativeJson(self.state.borrow().next_params())
    }
}
fn rpc_error(error: mcp_protocol_rust::jsonrpc::RpcError) -> convert::NativeJson {
    let mut fields = vec![
        ("code", Value::Number(error.code.into())),
        ("message", text(&error.message)),
    ];
    if let Some(data) = error.data {
        fields.push(("data", data));
    }
    convert::NativeJson(object(vec![("error", object(fields))]))
}

use tiny_mcp_client_rust::client::{ClientError, ClientState, ConnectionState};
#[napi]
#[derive(Default)]
pub struct NativeClient {
    state: RefCell<ClientState>,
}
#[napi]
impl NativeClient {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: RefCell::new(ClientState::default()),
        }
    }
    #[napi(getter)]
    pub fn status(&self) -> &'static str {
        match self.state.borrow().state() {
            ConnectionState::Disconnected => "disconnected",
            ConnectionState::Initializing => "initializing",
            ConnectionState::Ready => "ready",
            ConnectionState::Closed => "closed",
        }
    }
    #[napi(getter)]
    pub fn modern(&self) -> bool {
        self.state.borrow().modern()
    }
    #[napi(getter)]
    pub fn server_capabilities(&self) -> convert::NativeJson {
        convert::NativeJson(
            self.state
                .borrow()
                .server_capabilities()
                .unwrap_or(Value::Null),
        )
    }
    #[napi(getter)]
    pub fn server_info(&self) -> convert::NativeJson {
        convert::NativeJson(self.state.borrow().server_info().unwrap_or(Value::Null))
    }
    #[napi(getter)]
    pub fn instructions(&self) -> Option<Utf16String> {
        self.state.borrow().instructions().map(Into::into)
    }
    #[napi]
    pub fn begin_connect(&self) -> convert::NativeJson {
        match self.state.borrow_mut().begin_connect() {
            Ok(generation) => convert::NativeJson(object(vec![(
                "generation",
                Value::Number(generation as f64),
            )])),
            Err(error) => client_error(error),
        }
    }
    #[napi]
    pub fn connection_closed(&self, generation: f64) -> bool {
        self.state.borrow_mut().connection_closed(generation as u64)
    }
    #[napi]
    pub fn connection_failed(&self, generation: f64) -> bool {
        self.state.borrow_mut().connection_failed(generation as u64)
    }
    #[napi]
    pub fn prepare_capabilities(
        &self,
        env: Env,
        source: Unknown<'_>,
        roots: bool,
        sampling: bool,
        elicitation: bool,
    ) -> convert::NativeJson {
        let value = match input::read(&env, source, input::Mode::Json) {
            Ok(value) => value,
            Err(_) => {
                return client_error(ClientError {
                    code: Some(-32602),
                    message: "Invalid client capabilities".encode_utf16().collect(),
                });
            }
        };
        let mut caps = match value {
            Some(Value::Object(caps)) => caps,
            _ => vec![],
        };
        for (name, enabled) in [
            ("roots", roots),
            ("sampling", sampling),
            ("elicitation", elicitation),
        ] {
            if !enabled {
                continue;
            }
            let key = name.encode_utf16().collect::<Vec<_>>();
            if let Some((_, previous)) = caps.iter_mut().find(|(name, _)| name == &key) {
                if name == "roots" && !matches!(previous, Value::Object(_)) {
                    *previous = Value::Object(vec![]);
                }
            } else {
                caps.push((key, Value::Object(vec![])));
            }
        }
        let caps = Value::Object(caps);
        match self
            .state
            .borrow_mut()
            .set_client_capabilities(caps.clone())
        {
            Ok(()) => convert::NativeJson(object(vec![("capabilities", caps)])),
            Err(error) => client_error(error),
        }
    }
    #[napi]
    pub fn accept_connection(
        &self,
        env: Env,
        generation: f64,
        result: Unknown<'_>,
        discovery: bool,
    ) -> Result<convert::NativeJson> {
        let result = input::read(&env, result, input::Mode::Json)?.unwrap_or(Value::Null);
        let mut state = self.state.borrow_mut();
        let accepted = if discovery {
            state.accept_discovery(generation as u64, result)
        } else {
            state.accept_initialize(generation as u64, result)
        };
        Ok(match accepted {
            Ok(result) => convert::NativeJson(object(vec![("result", result)])),
            Err(error) => client_error(error),
        })
    }
    #[napi]
    pub fn check_capability(&self, capability: String) -> convert::NativeJson {
        match self.state.borrow().require_capability(&capability) {
            Ok(()) => convert::NativeJson(object(vec![])),
            Err(error) => client_error(error),
        }
    }
    #[napi]
    pub fn check_connection(&self) -> convert::NativeJson {
        match self.state.borrow().require_connection() {
            Ok(()) => convert::NativeJson(object(vec![])),
            Err(error) => client_error(error),
        }
    }
    #[napi]
    pub fn check_resource_subscriptions(&self) -> convert::NativeJson {
        match self.state.borrow().require_resource_subscriptions() {
            Ok(()) => convert::NativeJson(object(vec![])),
            Err(error) => client_error(error),
        }
    }
    #[napi]
    pub fn validate_result(
        &self,
        env: Env,
        method: String,
        result: Unknown<'_>,
    ) -> Result<convert::NativeJson> {
        let result = input::read(&env, result, input::Mode::Json)?.unwrap_or(Value::Null);
        Ok(
            match self.state.borrow().validate_result(&method, &result) {
                Ok(()) => convert::NativeJson(object(vec![])),
                Err(error) => client_error(error),
            },
        )
    }
    #[napi]
    pub fn notification_allowed(&self, env: Env, method: String, params: Unknown<'_>) -> bool {
        let params = input::read(&env, params, input::Mode::Json)
            .ok()
            .flatten()
            .unwrap_or(Value::Null);
        self.state.borrow().notification_allowed(&method, &params)
    }
    #[napi]
    pub fn track_progress(&self, env: Env, token: Unknown<'_>, add: bool) -> Result<()> {
        if let Some(token) = input::read(&env, token, input::Mode::Json)? {
            self.state.borrow_mut().track_progress(&token, add);
        }
        Ok(())
    }
    #[napi]
    pub fn set_subscription(&self, uri: Utf16String, active: bool) {
        let mut state = self.state.borrow_mut();
        if active {
            state.add_subscription(uri.to_vec());
        } else {
            state.remove_subscription(&uri);
        }
    }
    #[napi(getter)]
    pub fn roots_changes_allowed(&self) -> bool {
        self.state.borrow().roots_changes_allowed()
    }
    #[napi]
    pub fn close(&self) {
        self.state.borrow_mut().close();
    }
}
fn client_error(error: ClientError) -> convert::NativeJson {
    let mut fields = vec![("message", Value::String(error.message))];
    if let Some(code) = error.code {
        fields.push(("code", Value::Number(code.into())));
    }
    convert::NativeJson(object(vec![("error", object(fields))]))
}

use tiny_mcp_client_rust::subscriptions::{SubscriptionState, subscription_id};
#[napi]
#[derive(Default)]
pub struct NativeSubscriptions {
    state: RefCell<SubscriptionState>,
}
fn subscription_error(message: String) -> convert::NativeJson {
    convert::NativeJson(object(vec![("error", text(&message))]))
}
#[napi]
impl NativeSubscriptions {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn normalize(&self, env: Env, filter: Unknown<'_>) -> Result<convert::NativeJson> {
        let filter = input::read(&env, filter, input::Mode::Json)?.unwrap_or(Value::Null);
        Ok(match self.state.borrow().normalize(&filter) {
            Ok(filter) => convert::NativeJson(object(vec![("filter", filter)])),
            Err(error) => subscription_error(error),
        })
    }
    #[napi]
    pub fn register(
        &self,
        env: Env,
        id: Unknown<'_>,
        filter: Unknown<'_>,
    ) -> Result<convert::NativeJson> {
        let id = input::read(&env, id, input::Mode::Json)?.unwrap_or(Value::Null);
        let filter = input::read(&env, filter, input::Mode::Json)?.unwrap_or(Value::Null);
        Ok(match self.state.borrow_mut().register(id, filter) {
            Ok(()) => convert::NativeJson(object(vec![])),
            Err(error) => subscription_error(error),
        })
    }
    #[napi]
    pub fn acknowledge(&self, env: Env, params: Unknown<'_>) -> Result<convert::NativeJson> {
        let params = input::read(&env, params, input::Mode::Json)?.unwrap_or(Value::Null);
        Ok(match self.state.borrow_mut().acknowledge(&params) {
            Ok(Some(ack)) => {
                convert::NativeJson(object(vec![("id", ack.id), ("filter", ack.filter)]))
            }
            Ok(None) => convert::NativeJson(object(vec![])),
            Err(error) => convert::NativeJson(object(vec![
                (
                    "id",
                    subscription_id(&params).cloned().unwrap_or(Value::Null),
                ),
                ("error", text(&error)),
            ])),
        })
    }
    #[napi]
    pub fn accepts(&self, env: Env, method: String, params: Unknown<'_>) -> bool {
        let params = input::read(&env, params, input::Mode::Json)
            .ok()
            .flatten()
            .unwrap_or(Value::Null);
        self.state.borrow().accepts(&method, &params)
    }
    #[napi]
    pub fn validate_completion(
        &self,
        env: Env,
        id: Unknown<'_>,
        result: Unknown<'_>,
    ) -> Result<convert::NativeJson> {
        let id = input::read(&env, id, input::Mode::Json)?.unwrap_or(Value::Null);
        let result = input::read(&env, result, input::Mode::Json)?.unwrap_or(Value::Null);
        Ok(
            match self.state.borrow().validate_completion(&id, &result) {
                Ok(()) => convert::NativeJson(object(vec![])),
                Err(error) => subscription_error(error),
            },
        )
    }
    #[napi]
    pub fn remove(&self, env: Env, id: Unknown<'_>) -> Result<()> {
        if let Some(id) = input::read(&env, id, input::Mode::Json)? {
            self.state.borrow_mut().remove(&id);
        }
        Ok(())
    }
    #[napi]
    pub fn clear(&self) {
        self.state.borrow_mut().clear();
    }
}

use tiny_mcp_client_rust::stdio::StderrTail;
#[napi]
#[derive(Default)]
pub struct NativeStderr {
    state: RefCell<StderrTail>,
}
#[napi]
impl NativeStderr {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn append(&self, chunk: Utf16String) {
        self.state.borrow_mut().append(&chunk);
    }
    #[napi]
    pub fn snapshot(&self) -> Utf16String {
        Utf16String::from(self.state.borrow().snapshot())
    }
}

use tiny_mcp_client_rust::sse::SseParser;
#[napi]
pub struct NativeSseParser {
    state: RefCell<SseParser>,
}
#[napi]
impl NativeSseParser {
    #[napi(constructor)]
    pub fn new(limit: Option<f64>) -> Result<Self> {
        let limit = limit.unwrap_or(16.0 * 1024.0 * 1024.0);
        if !limit.is_finite()
            || limit.fract() != 0.0
            || !(1.0..=9_007_199_254_740_991.0).contains(&limit)
        {
            return Err(napi::Error::from_reason(
                "SSE event byte limit must be a positive safe integer",
            ));
        }
        Ok(Self {
            state: RefCell::new(SseParser::new(limit as usize).map_err(napi::Error::from_reason)?),
        })
    }
    #[napi(getter)]
    pub fn last_event_id(&self) -> Option<Utf16String> {
        self.state.borrow().last_event_id().map(Utf16String::from)
    }
    #[napi]
    pub fn push(&self, chunk: Utf16String) -> Result<convert::NativeJson> {
        let messages = self
            .state
            .borrow_mut()
            .push(&chunk)
            .map_err(napi::Error::from_reason)?;
        Ok(convert::NativeJson(Value::Array(
            messages
                .into_iter()
                .map(|message| {
                    let mut fields = vec![("data", Value::String(message.data))];
                    if let Some(id) = message.id {
                        fields.push(("id", Value::String(id)));
                    }
                    object(fields)
                })
                .collect(),
        )))
    }
    #[napi]
    pub fn flush(&self) -> convert::NativeJson {
        self.state.borrow_mut().flush();
        convert::NativeJson(Value::Array(vec![]))
    }
}

use tiny_mcp_client_rust::http::HttpResponseMessages;
#[napi]
pub struct NativeHttpResponseMessages {
    state: RefCell<HttpResponseMessages>,
}
#[napi]
impl NativeHttpResponseMessages {
    #[napi(constructor)]
    pub fn new(env: Env, request: Unknown<'_>) -> Result<Self> {
        let request = input::read(&env, request, input::Mode::Json)?.unwrap_or(Value::Null);
        Ok(Self {
            state: RefCell::new(
                HttpResponseMessages::new(request).map_err(napi::Error::from_reason)?,
            ),
        })
    }
    #[napi(getter)]
    pub fn completed(&self) -> bool {
        self.state.borrow().completed()
    }
    #[napi]
    pub fn validate(&self, line: Utf16String, allow_notifications: bool) -> Result<Utf16String> {
        self.state
            .borrow_mut()
            .validate(&line, allow_notifications)
            .map(Utf16String::from)
            .map_err(napi::Error::from_reason)
    }
}

#[napi]
pub fn sdk_message_to_line(env: Env, message: Unknown<'_>) -> Result<Utf16String> {
    let message = input::read(&env, message, input::Mode::Json)?.unwrap_or(Value::Null);
    if let Some(result) = message.get("result")
        && !result.is_json_value()
    {
        return Err(napi::Error::from_reason(
            "Response result must contain only JSON values",
        ));
    }
    if let Some(params) = message.get("params")
        && !params.is_json_value()
    {
        return Err(napi::Error::from_reason(
            "Message params must contain only JSON values",
        ));
    }
    Ok(Utf16String::from(
        (json::stringify(&message) + "\n")
            .encode_utf16()
            .collect::<Vec<_>>(),
    ))
}
#[napi]
pub fn parse_sdk_message(line: Utf16String) -> convert::NativeJson {
    match json::parse_utf16(&line, json::Limits::default()) {
        Ok(value @ Value::Object(_)) => convert::NativeJson(object(vec![("message", value)])),
        _ => convert::NativeJson(object(vec![(
            "error",
            Value::String(
                "Malformed JSON line: "
                    .encode_utf16()
                    .chain(line.iter().copied())
                    .collect(),
            ),
        )])),
    }
}
