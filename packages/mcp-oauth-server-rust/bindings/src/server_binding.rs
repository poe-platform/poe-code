use crate::convert::NativeJson;
use mcp_oauth_server_rust::{
    jwt::Jws,
    server::{self, Policy},
};
use mcp_protocol_rust::json::{self, Limits, Value};
use napi::bindgen_prelude::*;
use napi_derive::napi;
fn parse(text: &[u16]) -> Result<Value> {
    json::parse_utf16(text, Limits::default())
        .map_err(|_| napi::Error::from_reason("Invalid authorization-server input"))
}
fn output(result: std::result::Result<Value, server::Error>) -> NativeJson {
    let (key, value) = match result {
        Ok(value) => ("value", value),
        Err(error) => ("error", error.value()),
    };
    NativeJson(Value::Object(vec![(key.encode_utf16().collect(), value)]))
}
#[napi]
pub struct NativeAuthorizationPolicy {
    policy: Policy,
}
#[napi]
impl NativeAuthorizationPolicy {
    #[napi(constructor)]
    pub fn new(env: Env, options: Unknown<'_>) -> Result<Self> {
        Ok(Self {
            policy: Policy::new(crate::policy_input::read(
                &env,
                options,
                crate::policy_input::Mode::Configuration,
            )?)
            .map_err(|error| napi::Error::from_reason(error.message))?,
        })
    }
    #[napi(getter)]
    pub fn body_limit(&self) -> f64 {
        self.policy.body_limit
    }
    #[napi]
    pub fn call(&self, env: Env, command: String, input: Unknown<'_>) -> Result<NativeJson> {
        Ok(output(self.policy.call(
            &command,
            crate::policy_input::read(&env, input, crate::policy_input::Mode::Command(&command))?,
        )))
    }
}
#[napi]
pub fn authorization_url(info: Utf16String, label: String, issuer: bool) -> Result<NativeJson> {
    Ok(output(server::url_admission(
        &parse(&info)?,
        &label,
        issuer,
    )))
}
#[napi]
pub fn authorization_token_hash(token: Utf16String) -> String {
    let text = String::from_utf16_lossy(&token);
    mcp_oauth_rust::base64::encode_url(&mcp_oauth_rust::sha256(text.as_bytes()))
}
#[napi]
pub struct NativeAuthorizationBodyBudget {
    limit: f64,
    bytes: std::cell::Cell<f64>,
}
#[napi]
impl NativeAuthorizationBodyBudget {
    #[napi(constructor)]
    pub fn new(limit: f64) -> Self {
        Self {
            limit,
            bytes: std::cell::Cell::new(0.0),
        }
    }
    #[napi]
    pub fn declared(&self, length: f64) -> bool {
        length.is_finite() && length > self.limit
    }
    #[napi]
    pub fn admit(&self, bytes: f64) -> bool {
        let total = self.bytes.get() + bytes;
        self.bytes.set(total);
        total <= self.limit
    }
}
fn jose_error(error: server::Error) -> napi::Error {
    napi::Error::from_reason(json::stringify(&error.value()))
}
#[napi]
pub struct NativeAuthorizationJwt {
    jwt: Jws,
}
#[napi]
impl NativeAuthorizationJwt {
    #[napi(constructor)]
    pub fn new(token: Utf16String, algorithm: String) -> Result<Self> {
        Ok(Self {
            jwt: Jws::new(&token, &algorithm).map_err(jose_error)?,
        })
    }
    #[napi]
    pub fn signature_data(&self) -> Result<Vec<Buffer>> {
        let (signature, data) = self.jwt.signature_data().map_err(jose_error)?;
        Ok(vec![signature.into(), data.into()])
    }
    #[napi]
    pub fn claims(&self, issuer: Utf16String, audience: Utf16String, now: f64) -> NativeJson {
        output(self.jwt.claims(&issuer, &audience, now))
    }
}
#[napi]
pub fn authorization_key_plan(env: Env, key: Unknown<'_>, algorithm: String) -> Result<NativeJson> {
    mcp_oauth_rust::jwks::import_plan(
        &crate::policy_input::read(&env, key, crate::policy_input::Mode::Key)?,
        &algorithm,
    )
    .map(NativeJson)
    .map_err(napi::Error::from_reason)
}
