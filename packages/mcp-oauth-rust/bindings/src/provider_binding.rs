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
        provider::binding_action(
            &resource,
            object("session"),
            object("discovery"),
            object("configured"),
        )
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

#[napi]
pub fn provider_normalize_tokens(text: Utf16String) -> Result<NativeJson> {
    let tokens =
        provider::normalize_tokens_checked(&parse(&text)?).map_err(napi::Error::from_reason)?;
    Ok(NativeJson(tokens.unwrap_or(Value::Null)))
}
#[napi]
pub fn rejected_grant_matches(text: Utf16String) -> Result<bool> {
    let input = parse(&text)?;
    Ok(match (input.get("current"), input.get("rejected")) {
        (Some(current @ Value::Object(_)), Some(rejected @ Value::Object(_))) => {
            provider::same_token_grant(current, rejected)
        }
        _ => false,
    })
}

#[napi]
pub fn provider_normalize_imported_tokens(text: Utf16String, now: f64) -> Result<NativeJson> {
    let result = provider::normalize_imported_tokens(&parse(&text)?, now)
        .map_err(napi::Error::from_reason)?;
    Ok(NativeJson(result.unwrap_or(Value::Null)))
}

#[napi]
pub fn provider_token_method(text: Utf16String) -> Result<NativeJson> {
    let input = parse(&text)?;
    Ok(result(
        mcp_oauth_rust::token_auth::normalize(input.get("method"))
            .map(|method| {
                method.map_or(Value::Null, |method| {
                    Value::String(method.label().encode_utf16().collect())
                })
            })
            .map_err(str::to_owned),
    ))
}
#[napi]
pub fn provider_registration_method(text: Utf16String) -> Result<NativeJson> {
    let input = parse(&text)?;
    Ok(result(
        mcp_oauth_rust::token_auth::choose_registration_method(
            input.get("metadata").unwrap_or(&Value::Null),
            input.get("method"),
        )
        .map(|method| Value::String(method.label().encode_utf16().collect()))
        .map_err(str::to_owned),
    ))
}
#[napi]
pub fn provider_assert_token_method(text: Utf16String) -> Result<NativeJson> {
    let input = parse(&text)?;
    Ok(result(
        mcp_oauth_rust::token_auth::assert_supported(
            input.get("client").unwrap_or(&Value::Null),
            input.get("metadata").unwrap_or(&Value::Null),
        )
        .map(|()| Value::Null)
        .map_err(str::to_owned),
    ))
}
#[napi]
pub fn provider_assert_session_method(text: Utf16String) -> Result<NativeJson> {
    let input = parse(&text)?;
    Ok(result(
        mcp_oauth_rust::token_auth::normalize(input.get("method"))
            .and_then(|method| {
                mcp_oauth_rust::token_auth::assert_session_method(
                    input.get("client").unwrap_or(&Value::Null),
                    method,
                )
            })
            .map(|()| Value::Null)
            .map_err(str::to_owned),
    ))
}

#[napi]
pub fn provider_assert_scope(text: Utf16String, phase: u32) -> Result<NativeJson> {
    let input = parse(&text)?;
    let check = if phase == 2 {
        mcp_oauth_rust::scope::assert_authorization(input.get("granted"), input.get("requested"))
    } else {
        mcp_oauth_rust::scope::assert_profile(
            input.get("granted"),
            input.get("requested"),
            phase == 1,
        )
    };
    Ok(result(check.map(|()| Value::Null).map_err(str::to_owned)))
}

#[napi]
pub fn provider_assert_registration_issuer(
    text: Utf16String,
    issuer: Utf16String,
) -> Result<NativeJson> {
    Ok(result(
        mcp_oauth_rust::registration::assert_issuer(&parse(&text)?, &issuer)
            .map(|()| Value::Null)
            .map_err(str::to_owned),
    ))
}
#[napi]
pub fn provider_secret_needs_clock(text: Utf16String) -> Result<bool> {
    Ok(mcp_oauth_rust::registration::secret_expiry(&parse(&text)?).is_some())
}
#[napi]
pub fn provider_secret_expired(text: Utf16String, now: f64) -> Result<bool> {
    Ok(mcp_oauth_rust::registration::secret_expiry(&parse(&text)?)
        .is_some_and(|expiry| expiry <= now / 1000.0))
}

#[napi]
pub fn provider_caller_owned(text: Utf16String) -> Result<bool> {
    Ok(mcp_oauth_rust::registration::caller_owned(&parse(&text)?))
}
#[napi]
pub fn provider_imported_client(text: Utf16String) -> Result<u32> {
    let value = parse(&text)?;
    Ok(mcp_oauth_rust::registration::imported_client(
        value.get("existing"),
        value.get("stored"),
    ))
}
