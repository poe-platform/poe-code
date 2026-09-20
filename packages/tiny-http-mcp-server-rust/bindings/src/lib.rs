use mcp_protocol_rust::json::{self, Limits, Value};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::cell::RefCell;
mod auth_input;
pub mod cli_binding;
use convert::NativeJson;
use embedded_stdio::convert;
use tiny_http_mcp_server_rust::body::{self, BodyError, ByteBudget};
fn parse(text: &[u16]) -> Result<Value> {
    json::parse_utf16(text, Limits::default()).map_err(|_| napi::Error::from_reason("Parse error"))
}
#[napi]
pub fn classify_http_body(text: Utf16String, max_batch: Option<f64>) -> Result<NativeJson> {
    let outcome = body::classify(parse(&text)?, max_batch);
    let (key, value) = match outcome {
        Ok(v) => ("value", v),
        Err(error) => {
            let fields = match error {
                BodyError::Plain(message) => {
                    vec![("message", Value::String(message.encode_utf16().collect()))]
                }
                BodyError::Message { id, code, message } => vec![
                    ("message", Value::String(message.encode_utf16().collect())),
                    ("id", id),
                    ("code", Value::Number(code as f64)),
                ],
            };
            (
                "error",
                Value::Object(
                    fields
                        .into_iter()
                        .map(|(k, v)| (k.encode_utf16().collect(), v))
                        .collect(),
                ),
            )
        }
    };
    Ok(NativeJson(Value::Object(vec![(
        key.encode_utf16().collect(),
        value,
    )])))
}
#[napi]
pub struct NativeHttpBodyBudget {
    state: RefCell<ByteBudget>,
}
#[napi]
impl NativeHttpBodyBudget {
    #[napi(constructor)]
    pub fn new(limit: Option<f64>) -> Self {
        Self {
            state: RefCell::new(ByteBudget::new(limit)),
        }
    }
    #[napi]
    pub fn admit(&self, bytes: f64) -> bool {
        bytes.is_finite()
            && bytes >= 0.0
            && bytes.fract() == 0.0
            && bytes <= 9_007_199_254_740_991.0
            && self.state.borrow_mut().admit(bytes as u64)
    }
}
#[napi]
pub fn format_http_sse_event(
    data: Utf16String,
    id: Option<Utf16String>,
    event: Option<Utf16String>,
) -> Utf16String {
    tiny_http_mcp_server_rust::sse::format_event(
        &data,
        id.as_ref().map(|v| v.as_ref()),
        event.as_ref().map(|v| v.as_ref()),
    )
    .into()
}
#[napi]
pub fn validate_modern_headers(
    headers: Utf16String,
    request: Utf16String,
) -> Result<Option<NativeJson>> {
    Ok(
        tiny_http_mcp_server_rust::headers::validate_modern(&parse(&headers)?, &parse(&request)?)
            .map(|e| {
                NativeJson(Value::Object(vec![
                    (
                        "code".encode_utf16().collect(),
                        Value::Number(e.code as f64),
                    ),
                    (
                        "message".encode_utf16().collect(),
                        Value::String(e.message.encode_utf16().collect()),
                    ),
                ]))
            }),
    )
}
#[napi]
pub fn http_bearer_token(value: Option<Utf16String>) -> NativeJson {
    NativeJson(tiny_http_mcp_server_rust::auth::bearer_token(
        value.as_ref().map(|v| v.as_ref()),
    ))
}
#[napi]
pub fn http_bearer_challenge(url: Utf16String, options: Utf16String) -> Result<Utf16String> {
    Ok(tiny_http_mcp_server_rust::auth::challenge(&url, &parse(&options)?).into())
}
#[napi]
pub fn http_verifier_error(error: Unknown<'_>, required: Utf16String) -> Result<NativeJson> {
    Ok(NativeJson(
        tiny_http_mcp_server_rust::auth::normalize_error(
            &auth_input::read(error)?,
            &parse(&required)?,
        ),
    ))
}
#[napi]
pub fn http_scope_admission(required: Utf16String, verified: Utf16String) -> Result<bool> {
    Ok(tiny_http_mcp_server_rust::auth::scope_admission(
        &parse(&required)?,
        &parse(&verified)?,
    ))
}
#[napi]
pub fn http_request_origin(
    headers: Utf16String,
    encrypted: bool,
    trusted: bool,
) -> Result<NativeJson> {
    Ok(NativeJson(tiny_http_mcp_server_rust::auth::request_origin(
        &parse(&headers)?,
        encrypted,
        trusted,
    )))
}
#[napi]
pub fn http_metadata_path(path: Option<Utf16String>) -> Utf16String {
    tiny_http_mcp_server_rust::auth::metadata_path(path.as_ref().map(|v| v.as_ref())).into()
}
#[napi]
pub fn protected_resource_metadata(options: Utf16String) -> Result<NativeJson> {
    Ok(NativeJson(tiny_http_mcp_server_rust::auth::metadata(
        &parse(&options)?,
    )))
}

mod session_binding;

#[path = "../../../tiny-stdio-mcp-server-rust/bindings/src/lib.rs"]
pub mod embedded_stdio;
mod history_binding;
pub mod policy_binding;
mod testing_binding;

#[napi]
pub fn http_test_reverse(text: Utf16String) -> Utf16String {
    tiny_http_mcp_server_rust::testing::reverse_units(&text).into()
}

#[path = "../../../tiny-mcp-client-rust/bindings/src/lib.rs"]
pub mod embedded_client;
use embedded_client::NativeHttpResponseMessages;
