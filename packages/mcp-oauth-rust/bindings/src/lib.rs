use napi::bindgen_prelude::*;
use napi_derive::napi;
#[path = "../../../auth-store-rust/bindings/src/api.rs"]
pub mod credential_api;
pub mod provider_binding;
#[napi]
pub fn encode_code_verifier(entropy: Buffer) -> Result<String> {
    mcp_oauth_rust::generate_code_verifier(&entropy).map_err(napi::Error::from_reason)
}

#[napi]
pub fn read_stored_oauth_value(text: Utf16String, client: bool) -> convert::NativeJson {
    let parsed = match json::parse_utf16(&text, Limits::default()) {
        Ok(value) => value,
        Err(_) => {
            return convert::NativeJson(Value::Object(vec![(
                "parseError".encode_utf16().collect(),
                Value::Bool(true),
            )]));
        }
    };
    let result = if client {
        mcp_oauth_rust::session::read_stored_client(&parsed)
    } else if mcp_oauth_rust::session::validate_session(&parsed) {
        Ok(parsed)
    } else {
        Err("Stored OAuth session must match the expected shape")
    };
    let (key, value) = match result {
        Ok(value) => ("value", value),
        Err(message) => ("error", Value::String(message.encode_utf16().collect())),
    };
    convert::NativeJson(Value::Object(vec![(key.encode_utf16().collect(), value)]))
}
#[napi]
pub fn oauth_storage_defaults(key: Utf16String, client: bool) -> convert::NativeJson {
    let key = char::decode_utf16(key.iter().copied())
        .map(|point| point.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect::<String>();
    let hash = mcp_oauth_rust::sha256(key.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let (salt, directory, service, prefix) = if client {
        (
            "poe-code:mcp-oauth:clients:v1",
            ".poe-code/mcp-oauth/clients",
            "poe-code-mcp-oauth-clients",
            "issuer",
        )
    } else {
        (
            "poe-code:mcp-oauth:v1",
            ".poe-code/mcp-oauth",
            "poe-code-mcp-oauth",
            "provider",
        )
    };
    convert::NativeJson(Value::Object(
        [
            ("hash", hash.as_str()),
            ("salt", salt),
            ("directory", directory),
            ("service", service),
            ("accountPrefix", prefix),
        ]
        .into_iter()
        .map(|(key, value)| {
            (
                key.encode_utf16().collect(),
                Value::String(value.encode_utf16().collect()),
            )
        })
        .collect(),
    ))
}
#[napi]
pub fn generate_code_challenge(verifier: Utf16String) -> String {
    mcp_oauth_rust::generate_code_challenge(&verifier)
}
#[napi]
pub fn hash_bytes(bytes: Buffer) -> Buffer {
    mcp_oauth_rust::sha256(&bytes).to_vec().into()
}

#[path = "../../../mcp-protocol-rust/bindings/src/convert.rs"]
mod convert;
use mcp_protocol_rust::json::Value;
#[napi]
pub fn create_authorization_state(
    issuer: Utf16String,
    require_issuer: bool,
    entropy: Buffer,
) -> Result<String> {
    mcp_oauth_rust::state::create_authorization_state(&issuer, require_issuer, &entropy)
        .map_err(napi::Error::from_reason)
}
#[napi]
pub fn parse_authorization_state(text: Option<Utf16String>) -> convert::NativeJson {
    let parsed =
        mcp_oauth_rust::state::parse_authorization_state(text.as_ref().map(|text| text.as_ref()));
    convert::NativeJson(match parsed {
        Some(parsed) => Value::Object(vec![
            (
                "issuer".encode_utf16().collect(),
                Value::String(parsed.issuer),
            ),
            (
                "requireIssuer".encode_utf16().collect(),
                Value::Bool(parsed.require_issuer),
            ),
        ]),
        None => Value::Null,
    })
}

#[napi]
pub fn decode_authorization_bytes(text: Utf16String) -> Buffer {
    mcp_oauth_rust::base64::decode_lenient(&text).into()
}

use mcp_oauth_rust::response::ResponseBudget;
use std::cell::RefCell;
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
            .check_content_length(length.as_ref().map(|length| length.as_ref()))
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

use mcp_oauth_rust::tokens::{ResponseError, TokenFields};
use mcp_protocol_rust::json::{self, Limits};
#[napi]
pub struct NativeTokenFields {
    fields: TokenFields,
}
#[napi]
impl NativeTokenFields {
    #[napi(constructor)]
    pub fn new(text: Utf16String) -> Result<Self> {
        let payload = json::parse_utf16(&text, Limits::default())
            .map_err(|_| napi::Error::from_reason("OAuth response must be a JSON object"))?;
        Ok(Self {
            fields: TokenFields::parse(&payload).map_err(napi::Error::from_reason)?,
        })
    }
    #[napi(getter)]
    pub fn needs_clock(&self) -> bool {
        self.fields.needs_clock()
    }
    #[napi]
    pub fn complete(&self, now: Option<f64>) -> Result<convert::NativeJson> {
        self.fields
            .complete(now)
            .map(convert::NativeJson)
            .map_err(napi::Error::from_reason)
    }
}
#[napi]
pub fn read_token_response(
    text: Utf16String,
    ok: bool,
    status: f64,
) -> Result<convert::NativeJson> {
    let (key, value) = match mcp_oauth_rust::tokens::read_json_response(&text, ok, status) {
        Ok(value) => ("payload", value),
        Err(ResponseError::OAuth(shape)) => ("error", shape),
        Err(ResponseError::InvalidObject) => {
            return Err(napi::Error::from_reason(
                "OAuth response must be a JSON object",
            ));
        }
    };
    Ok(convert::NativeJson(Value::Object(vec![(
        key.encode_utf16().collect(),
        value,
    )])))
}
#[napi]
pub fn is_retryable_token_error(error: Utf16String, status: f64) -> bool {
    mcp_oauth_rust::tokens::is_retryable(&error, status)
}
#[napi]
pub fn encode_token_form(text: Utf16String) -> Result<String> {
    let payload = json::parse_utf16(&text, Limits::default())
        .map_err(|_| napi::Error::from_reason("Invalid OAuth form"))?;
    let Value::Object(properties) = payload else {
        return Err(napi::Error::from_reason("Invalid OAuth form"));
    };
    let pairs = properties
        .into_iter()
        .map(|(key, value)| match value {
            Value::String(value) => Ok((key, value)),
            _ => Err(napi::Error::from_reason("Invalid OAuth form value")),
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(mcp_oauth_rust::tokens::encode_form(&pairs))
}

#[napi]
pub fn normalize_callback_input(text: Utf16String) -> Utf16String {
    mcp_oauth_rust::loopback::normalize_input(&text).into()
}
#[napi]
pub fn render_success_page(title: Option<Utf16String>, body: Option<Utf16String>) -> Utf16String {
    mcp_oauth_rust::loopback::build_success_page(
        title.as_ref().map(|text| text.as_ref()),
        body.as_ref().map(|text| text.as_ref()),
    )
    .into()
}
#[napi]
pub struct NativeCallbackBinding {
    binding: mcp_oauth_rust::loopback::CallbackBinding,
}
#[napi]
impl NativeCallbackBinding {
    #[napi(constructor)]
    pub fn new(state: Option<Utf16String>) -> Self {
        Self {
            binding: mcp_oauth_rust::loopback::CallbackBinding::new(
                state.map(|state| state.to_vec()),
            ),
        }
    }
    #[napi]
    pub fn resolve(&self, text: Utf16String) -> Result<convert::NativeJson> {
        let payload = json::parse_utf16(&text, Limits::default())
            .map_err(|_| napi::Error::from_reason("Invalid OAuth callback"))?;
        let field = |key| match payload.get(key) {
            Some(Value::String(text)) => Some(text.clone()),
            _ => None,
        };
        let callback = mcp_oauth_rust::loopback::CallbackParameters {
            code: field("code"),
            error: field("error"),
            error_description: field("errorDescription"),
            state: field("state"),
            issuer: field("iss"),
        };
        let fields = match self.binding.resolve(&callback) {
            Ok(code) => vec![("code".encode_utf16().collect(), Value::String(code))],
            Err(error) => vec![
                (
                    "error".encode_utf16().collect(),
                    Value::String(error.message),
                ),
                (
                    "response".encode_utf16().collect(),
                    Value::String(error.response),
                ),
            ],
        };
        Ok(convert::NativeJson(Value::Object(fields)))
    }
}
