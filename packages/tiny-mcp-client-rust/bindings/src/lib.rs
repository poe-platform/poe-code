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
