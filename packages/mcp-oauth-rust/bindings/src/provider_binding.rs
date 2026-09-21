use crate::convert::NativeJson;
use mcp_oauth_rust::provider::{self, RetryState, SessionFlow};
use mcp_protocol_rust::json::{self, Limits, Value};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::{cell::RefCell, collections::HashMap};
fn parse(text: &[u16]) -> Result<Value> {
    json::parse_utf16(text, Limits::default())
        .map_err(|_| napi::Error::from_reason("Invalid OAuth provider data"))
}
fn result(value: std::result::Result<Value, String>) -> NativeJson {
    let (key, value) = match value {
        Ok(value) => ("value", value),
        Err(error) => ("error", Value::String(error.encode_utf16().collect())),
    };
    NativeJson(Value::Object(vec![(key.encode_utf16().collect(), value)]))
}
#[napi]
pub fn provider_normalize_session(text: Utf16String) -> Result<NativeJson> {
    let input = parse(&text)?;
    let client = provider::normalize_client(input.get("client").unwrap_or(&Value::Null), false);
    let tokens = if client.is_some() {
        provider::normalize_tokens_checked(input.get("tokens").unwrap_or(&Value::Null))
            .map_err(napi::Error::from_reason)?
    } else {
        None
    };
    Ok(NativeJson(Value::Object(vec![
        (
            "client".encode_utf16().collect(),
            client.unwrap_or(Value::Null),
        ),
        (
            "tokens".encode_utf16().collect(),
            tokens.unwrap_or(Value::Null),
        ),
    ])))
}
#[napi]
pub fn provider_normalize_client(text: Utf16String, configured: bool) -> Result<NativeJson> {
    Ok(NativeJson(
        provider::normalize_client(&parse(&text)?, configured).unwrap_or(Value::Null),
    ))
}
#[napi]
pub struct NativeSessionFlow {
    state: RefCell<SessionFlow>,
}
#[napi]
impl NativeSessionFlow {
    #[napi(constructor)]
    pub fn new(
        tokens: Utf16String,
        discovery: bool,
        interactive: bool,
        force: bool,
    ) -> Result<Self> {
        let tokens = provider::normalize_tokens(&parse(&tokens)?);
        Ok(Self {
            state: RefCell::new(SessionFlow::new(tokens, discovery, interactive, force)),
        })
    }
    #[napi]
    pub fn next(&self, now: Option<f64>) -> String {
        self.state.borrow_mut().next(now).name().to_owned()
    }
    #[napi]
    pub fn refreshed(&self, tokens: Utf16String) -> Result<()> {
        self.state
            .borrow_mut()
            .refreshed(provider::normalize_tokens(&parse(&tokens)?));
        Ok(())
    }
}
#[napi]
pub fn is_stored_token_expired(expires: f64, now: f64) -> bool {
    expires <= now
}
#[napi]
pub fn provider_endpoints(metadata: Utf16String, interactive: bool) -> Result<NativeJson> {
    Ok(result(provider::metadata_endpoints(
        &parse(&metadata)?,
        interactive,
    )))
}
#[napi]
pub fn provider_validate_endpoint(
    input: Utf16String,
    label: String,
    secure: bool,
) -> Result<NativeJson> {
    let input = parse(&input)?;
    let field = |key| match input.get(key) {
        Some(Value::String(text)) => String::from_utf16_lossy(text),
        _ => String::new(),
    };
    let protocol = field("protocol");
    let hostname = field("hostname");
    let endpoint = provider::Endpoint {
        protocol: &protocol,
        hostname: &hostname,
        credentials: input.get("credentials") == Some(&Value::Bool(true)),
        fragment: input.get("fragment") == Some(&Value::Bool(true)),
        access_token: input.get("accessToken") == Some(&Value::Bool(true)),
    };
    Ok(result(
        endpoint.validate(&label, secure).map(|()| Value::Null),
    ))
}
#[napi]
pub fn provider_binding_action(resource: Utf16String, input: Utf16String) -> Result<NativeJson> {
    let input = parse(&input)?;
    let object = |key| {
        input
            .get(key)
            .filter(|value| matches!(value, Value::Object(_)))
    };
    Ok(result(
        provider::binding_action(&resource, object("session"), object("discovery"))
            .map(|value| Value::String(value.encode_utf16().collect())),
    ))
}
#[napi]
pub fn provider_stored_discovery(input: Utf16String, resource: Utf16String) -> Result<NativeJson> {
    Ok(NativeJson(
        provider::stored_discovery(&parse(&input)?, &resource).unwrap_or(Value::Null),
    ))
}
#[napi]
pub fn provider_initial_client(options: Utf16String, registration: bool) -> Result<NativeJson> {
    Ok(result(provider::initial_client(
        &parse(&options)?,
        registration,
    )))
}
#[napi]
pub fn provider_dynamic_client(input: Utf16String, registration: bool) -> Result<NativeJson> {
    let input = parse(&input)?;
    Ok(result(provider::dynamic_client(
        input.get("options").unwrap_or(&Value::Null),
        input
            .get("stored")
            .filter(|value| matches!(value, Value::Object(_))),
        input
            .get("existing")
            .filter(|value| matches!(value, Value::Object(_))),
        registration,
    )))
}
#[napi]
pub fn provider_registration_body(
    metadata: Utf16String,
    redirect: Utf16String,
) -> Result<NativeJson> {
    Ok(NativeJson(provider::registration_body(
        &parse(&metadata)?,
        &redirect,
    )))
}
#[napi]
pub fn provider_registered_client(payload: Utf16String) -> Result<NativeJson> {
    Ok(result(provider::registered_client(&parse(&payload)?)))
}
#[napi]
pub fn provider_authorization_plan(input: Utf16String, entropy: Buffer) -> Result<NativeJson> {
    Ok(result(provider::authorization_plan(
        &parse(&input)?,
        &entropy,
    )))
}
#[napi]
pub fn provider_request_matches(request: Utf16String, resource: Utf16String) -> NativeJson {
    if request.as_ref() == resource.as_ref() {
        return NativeJson(Value::Object(vec![(
            "value".encode_utf16().collect(),
            Value::Null,
        )]));
    }
    let mut message: Vec<u16> = "OAuth request URL ".encode_utf16().collect();
    message.extend(request.iter());
    message.extend(" does not match discovered resource ".encode_utf16());
    message.extend(resource.iter());
    NativeJson(Value::Object(vec![(
        "error".encode_utf16().collect(),
        Value::String(message),
    )]))
}
#[napi]
#[derive(Default)]
pub struct NativeOAuthRetryState {
    state: RefCell<RetryState>,
}
#[napi]
impl NativeOAuthRetryState {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn refresh(
        &self,
        oauth: bool,
        error: Utf16String,
        status: f64,
        registered: Option<bool>,
    ) -> String {
        self.state
            .borrow_mut()
            .refresh(oauth, &String::from_utf16_lossy(&error), status, registered)
            .to_owned()
    }
    #[napi]
    pub fn authorization(
        &self,
        oauth: bool,
        error: Utf16String,
        status: f64,
        stored_dynamic: bool,
    ) -> String {
        self.state
            .borrow_mut()
            .authorization(
                oauth,
                &String::from_utf16_lossy(&error),
                status,
                stored_dynamic,
            )
            .to_owned()
    }
}
#[napi]
#[derive(Default)]
pub struct NativeProviderClientCache {
    state: RefCell<ClientCache>,
}
type ClientCache = HashMap<Vec<u16>, (Option<Value>, bool)>;
#[napi]
impl NativeProviderClientCache {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn find(&self, issuer: Utf16String) -> NativeJson {
        let state = self.state.borrow();
        let client = state.get(issuer.as_ref());
        NativeJson(Value::Object(vec![
            (
                "found".encode_utf16().collect(),
                Value::Bool(client.is_some()),
            ),
            (
                "client".encode_utf16().collect(),
                client
                    .and_then(|(value, _)| value.clone())
                    .unwrap_or(Value::Null),
            ),
            (
                "undefinedSecret".encode_utf16().collect(),
                Value::Bool(client.is_some_and(|(_, undefined)| *undefined)),
            ),
        ]))
    }
    #[napi]
    pub fn store(
        &self,
        issuer: Utf16String,
        client: Utf16String,
        undefined_secret: bool,
    ) -> Result<()> {
        self.state.borrow_mut().insert(
            issuer.to_vec(),
            (
                provider::normalize_client(&parse(&client)?, false),
                undefined_secret,
            ),
        );
        Ok(())
    }
    #[napi]
    pub fn remove(&self, issuer: Utf16String) {
        self.state.borrow_mut().remove(issuer.as_ref());
    }
}
