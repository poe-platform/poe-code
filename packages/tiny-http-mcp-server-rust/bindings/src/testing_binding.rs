use super::convert::NativeJson;
use mcp_protocol_rust::json::Value;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::cell::RefCell;
use tiny_http_mcp_server_rust::testing::{TestTokens, VerificationError};

fn fields(values: Vec<(&str, Value)>) -> NativeJson {
    NativeJson(Value::Object(
        values
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    ))
}
fn error(value: VerificationError) -> NativeJson {
    let message = match value {
        VerificationError::Unknown => "unknown token",
        VerificationError::Issuer => "issuer mismatch",
        VerificationError::Audience => "audience mismatch",
        VerificationError::Expired => "token expired",
        VerificationError::Scope => "insufficient scope",
    };
    fields(vec![
        (
            "error",
            Value::String(
                if value == VerificationError::Scope {
                    "insufficient_scope"
                } else {
                    "invalid_token"
                }
                .encode_utf16()
                .collect(),
            ),
        ),
        (
            "errorDescription",
            Value::String(message.encode_utf16().collect()),
        ),
    ])
}

#[napi]
pub struct NativeHttpTestTokens {
    state: RefCell<TestTokens>,
}
#[napi]
impl NativeHttpTestTokens {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: RefCell::new(TestTokens::default()),
        }
    }
    #[napi]
    pub fn prepare(&self, token: Option<Utf16String>) -> NativeJson {
        match self.state.borrow_mut().prepare(token.map(|s| s.to_vec())) {
            Ok(token) => fields(vec![("token", Value::String(token))]),
            Err(token) => fields(vec![("duplicate", Value::String(token))]),
        }
    }
    #[napi]
    pub fn issue(
        &self,
        token: Option<Utf16String>,
        issuer: Utf16String,
        audience: Vec<Utf16String>,
        scopes: Vec<Utf16String>,
        expires_at: f64,
    ) -> NativeJson {
        match self.state.borrow_mut().issue(
            token.map(|s| s.to_vec()),
            issuer.to_vec(),
            audience.into_iter().map(|s| s.to_vec()).collect(),
            scopes.into_iter().map(|s| s.to_vec()).collect(),
            expires_at,
        ) {
            Ok((token, slot)) => fields(vec![
                ("token", Value::String(token)),
                ("slot", Value::Number(slot as f64)),
            ]),
            Err(token) => fields(vec![("duplicate", Value::String(token))]),
        }
    }
    #[napi]
    pub fn lookup(
        &self,
        token: Utf16String,
        resource: Utf16String,
        servers: Vec<Utf16String>,
    ) -> NativeJson {
        match self.state.borrow().lookup(
            &token,
            &resource,
            &servers.into_iter().map(|s| s.to_vec()).collect::<Vec<_>>(),
        ) {
            Ok(slot) => fields(vec![("slot", Value::Number(slot as f64))]),
            Err(value) => error(value),
        }
    }
    #[napi]
    pub fn admit(&self, slot: f64, required: Vec<Utf16String>, now: f64) -> NativeJson {
        if !slot.is_finite() || slot < 0.0 || slot.fract() != 0.0 || slot > 9_007_199_254_740_991.0
        {
            return error(VerificationError::Unknown);
        }
        match self.state.borrow().admit(
            slot as usize,
            &required.into_iter().map(|s| s.to_vec()).collect::<Vec<_>>(),
            now,
        ) {
            Ok(()) => fields(vec![]),
            Err(value) => error(value),
        }
    }
}
