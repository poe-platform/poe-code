use mcp_protocol_rust::json::{self, Limits, Value};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::cell::RefCell;
mod auth_input;
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

#[path = "../../../mcp-oauth-rust/bindings/src/jwks_binding.rs"]
pub mod jwks_binding;
use mcp_oauth_rust::response::ResponseBudget;
#[napi]
pub struct NativeResponseBudget {
    state: RefCell<ResponseBudget>,
}
#[napi]
impl NativeResponseBudget {
    #[napi(constructor)]
    pub fn new(limit: f64) -> Result<Self> {
        Ok(Self {
            state: RefCell::new(ResponseBudget::new(limit).map_err(napi::Error::from_reason)?),
        })
    }
    #[napi]
    pub fn check_content_length(&self, length: Option<Utf16String>) -> Result<()> {
        self.state
            .borrow_mut()
            .check_content_length(length.as_ref().map(|v| v.as_ref()))
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn admit(&self, bytes: f64) -> Result<()> {
        if !bytes.is_finite()
            || bytes.fract() != 0.0
            || !(0.0..=9_007_199_254_740_991.0).contains(&bytes)
        {
            return Err(napi::Error::from_reason(
                "HTTP response chunk size must be a nonnegative safe integer",
            ));
        }
        self.state
            .borrow_mut()
            .admit(bytes as u64)
            .map_err(napi::Error::from_reason)
    }
}
#[napi]
pub fn check_http_redirect(redirected: bool, response_type: String) -> Result<()> {
    mcp_oauth_rust::response::validate_redirect(redirected, &response_type)
        .map_err(napi::Error::from_reason)
}
