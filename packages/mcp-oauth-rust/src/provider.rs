//! OAuth provider policy and effect machines. Hosts execute asynchronous I/O.
use crate::tokens::is_retryable;
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn property(key: &str, value: Value) -> (Vec<u16>, Value) {
    (text(key), value)
}
fn string<'a>(value: &'a Value, key: &str) -> Option<&'a [u16]> {
    match value.get(key) {
        Some(Value::String(text)) => Some(text),
        _ => None,
    }
}
fn trimmed(value: &Value, key: &str) -> Option<Vec<u16>> {
    let value = trim_ecmascript(string(value, key)?);
    (!value.is_empty()).then(|| value.to_vec())
}
pub fn normalize_client(value: &Value, configured: bool) -> Option<Value> {
    let id = trimmed(value, "clientId")?;
    let secret = trimmed(value, "clientSecret");
    if !configured && value.get("clientSecret").is_some() && secret.is_none() {
        return None;
    }
    let mut fields = vec![property("clientId", Value::String(id))];
    if let Some(secret) = secret {
        fields.push(property("clientSecret", Value::String(secret)));
    }
    for key in ["registration", "tokenEndpointAuthMethod"] {
        if let Some(value) = value.get(key) {
            fields.push(property(key, value.clone()));
        }
    }
    Some(Value::Object(fields))
}
pub fn normalize_tokens(value: &Value) -> Option<Value> {
    let access = trimmed(value, "accessToken")?;
    if string(value, "tokenType") != Some(text("Bearer").as_slice()) {
        return None;
    }
    let expires = value.get("expiresAt")?;
    match expires {
        Value::Null => {}
        Value::Number(number)
            if number.is_finite()
                && number.fract() == 0.0
                && number.abs() <= 8_640_000_000_000_000.0 => {}
        _ => return None,
    }
    let refresh = trimmed(value, "refreshToken");
    if value.get("refreshToken").is_some() && refresh.is_none() {
        return None;
    }
    let mut fields = vec![
        property("accessToken", Value::String(access)),
        property("tokenType", Value::String(text("Bearer"))),
        property("expiresAt", expires.clone()),
    ];
    if let Some(refresh) = refresh {
        fields.push(property("refreshToken", Value::String(refresh)));
    }
    if let Some(scope) = crate::scope::normalize(value.get("scope")).ok()? {
        fields.push(property("scope", Value::String(scope)));
    }
    Some(Value::Object(fields))
}
#[derive(Debug, PartialEq, Eq)]
pub enum Effect {
    Clock,
    Continue,
    Use,
    Refresh,
    ClearTokens,
    Authorize,
    Return,
}
impl Effect {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Clock => "clock",
            Self::Continue => "continue",
            Self::Use => "use",
            Self::Refresh => "refresh",
            Self::ClearTokens => "clear",
            Self::Authorize => "authorize",
            Self::Return => "return",
        }
    }
}
enum Stage {
    Cached,
    Refresh,
    AwaitRefresh,
    Refreshed,
    Finish,
    Ready,
    Terminal,
}
pub struct SessionFlow {
    tokens: Option<Value>,
    discovery: bool,
    interactive: bool,
    force: bool,
    stage: Stage,
}
impl SessionFlow {
    pub fn new(tokens: Option<Value>, discovery: bool, interactive: bool, force: bool) -> Self {
        Self {
            tokens,
            discovery,
            interactive,
            force,
            stage: Stage::Cached,
        }
    }
    fn expired(&self, now: Option<f64>) -> Option<bool> {
        match self
            .tokens
            .as_ref()
            .and_then(|tokens| tokens.get("expiresAt"))
        {
            Some(Value::Number(expires)) => now.map(|now| *expires <= now),
            _ => Some(false),
        }
    }
    pub fn next(&mut self, now: Option<f64>) -> Effect {
        match self.stage {
            Stage::Cached => {
                if self.tokens.is_some() && !self.force {
                    match self.expired(now) {
                        None => return Effect::Clock,
                        Some(false) => {
                            self.stage = Stage::Terminal;
                            return Effect::Use;
                        }
                        Some(true) => {}
                    }
                }
                self.stage = Stage::Refresh;
                Effect::Continue
            }
            Stage::Refresh => {
                if self.discovery
                    && self
                        .tokens
                        .as_ref()
                        .is_some_and(|tokens| tokens.get("refreshToken").is_some())
                {
                    let expired = if self.force {
                        Some(true)
                    } else {
                        self.expired(now)
                    };
                    match expired {
                        None => return Effect::Clock,
                        Some(true) => {
                            self.stage = Stage::AwaitRefresh;
                            return Effect::Refresh;
                        }
                        Some(false) => {}
                    }
                }
                self.stage = Stage::Finish;
                Effect::Continue
            }
            Stage::Refreshed => {
                if self.tokens.is_some() {
                    match self.expired(now) {
                        None => return Effect::Clock,
                        Some(false) => {
                            self.stage = Stage::Terminal;
                            return Effect::Use;
                        }
                        Some(true) => {}
                    }
                }
                self.stage = Stage::Finish;
                Effect::Continue
            }
            Stage::Finish => {
                self.stage = Stage::Ready;
                if self.force && self.tokens.take().is_some() {
                    Effect::ClearTokens
                } else {
                    Effect::Continue
                }
            }
            Stage::Ready => {
                self.stage = Stage::Terminal;
                if self.interactive && self.discovery {
                    Effect::Authorize
                } else {
                    Effect::Return
                }
            }
            Stage::AwaitRefresh | Stage::Terminal => Effect::Return,
        }
    }
    pub fn refreshed(&mut self, tokens: Option<Value>) {
        self.tokens = tokens;
        self.stage = Stage::Refreshed;
    }
}
pub struct Endpoint<'a> {
    pub protocol: &'a str,
    pub hostname: &'a str,
    pub credentials: bool,
    pub fragment: bool,
    pub access_token: bool,
}
impl Endpoint<'_> {
    pub fn validate(&self, label: &str, secure: bool) -> Result<(), String> {
        if !secure {
            return if self.access_token {
                Err(format!("{label} must not include access_token in the URI"))
            } else {
                Ok(())
            };
        }
        if self.credentials || self.fragment {
            return Err(format!("{label} must not include credentials or fragment"));
        }
        let hostname = self
            .hostname
            .strip_suffix('.')
            .unwrap_or(self.hostname)
            .to_ascii_lowercase();
        let loopback = matches!(hostname.as_str(), "localhost" | "::1" | "[::1]")
            || hostname
                .parse::<std::net::Ipv4Addr>()
                .is_ok_and(|ip| ip.octets()[0] == 127);
        if self.protocol == "https:" || self.protocol == "http:" && loopback {
            return Ok(());
        }
        Err(format!(
            "{label} must use https unless it targets a loopback host"
        ))
    }
}
#[derive(Default)]
pub struct RetryState {
    transient: bool,
    registration: bool,
}
impl RetryState {
    pub fn refresh(
        &mut self,
        oauth: bool,
        error: &str,
        status: f64,
        registered: Option<bool>,
    ) -> &'static str {
        if oauth && error == "invalid_grant" {
            return "clear";
        }
        let Some(registered) = registered else {
            return "load";
        };
        if oauth && error == "invalid_client" && registered {
            return "reregister";
        }
        if oauth && !self.transient && is_retryable(&text(error), status) {
            self.transient = true;
            return "retry";
        }
        "throw"
    }
    pub fn authorization(
        &mut self,
        oauth: bool,
        error: &str,
        status: f64,
        stored_dynamic: bool,
    ) -> &'static str {
        if oauth && error == "invalid_client" && stored_dynamic && !self.registration {
            self.registration = true;
            return "reregister";
        }
        if oauth && !self.transient && is_retryable(&text(error), status) {
            self.transient = true;
            return "retry";
        }
        "throw"
    }
}
fn required<'a>(value: &'a Value, key: &str) -> Result<&'a [u16], String> {
    string(value, key).ok_or_else(|| format!("Authorization server metadata is missing {key}"))
}
fn supports_pkce(metadata: &Value) -> bool {
    matches!(metadata.get("code_challenge_methods_supported"),Some(Value::Array(values)) if values.iter().all(|value|matches!(value,Value::String(_))) && values.iter().any(|value|value==&Value::String(text("S256"))))
}
pub fn metadata_endpoints(metadata: &Value, interactive: bool) -> Result<Value, String> {
    if interactive && !supports_pkce(metadata) {
        return Err("Authorization server metadata must advertise code_challenge_methods_supported including S256".into());
    }
    let mut fields = vec![
        property(
            "authorization",
            Value::String(required(metadata, "authorization_endpoint")?.to_vec()),
        ),
        property(
            "token",
            Value::String(required(metadata, "token_endpoint")?.to_vec()),
        ),
    ];
    if let Some(registration) = string(metadata, "registration_endpoint") {
        fields.push(property(
            "registration",
            Value::String(registration.to_vec()),
        ));
    }
    Ok(Value::Object(fields))
}
pub fn stored_discovery(session: &Value, resource: &[u16]) -> Option<Value> {
    let discovery = session.get("discovery")?;
    let metadata = discovery.get("authorizationServerMetadata")?;
    required(metadata, "issuer").ok()?;
    required(metadata, "authorization_endpoint").ok()?;
    required(metadata, "token_endpoint").ok()?;
    if !supports_pkce(metadata) {
        return None;
    }
    Some(Value::Object(vec![
        property("resource", Value::String(resource.to_vec())),
        property(
            "resourceMetadataUrl",
            discovery.get("resourceMetadataUrl")?.clone(),
        ),
        property(
            "resourceMetadata",
            discovery.get("resourceMetadata")?.clone(),
        ),
        property(
            "authorizationServer",
            session.get("authorizationServer")?.clone(),
        ),
        property("authorizationServerMetadataUrl", Value::String(vec![])),
        property("authorizationServerMetadata", metadata.clone()),
    ]))
}
pub fn binding_action(
    resource: &[u16],
    session: Option<&Value>,
    discovery: Option<&Value>,
    configured: Option<&Value>,
) -> Result<&'static str, String> {
    if let Some(discovery) = discovery
        && discovery
            .get("authorizationServerMetadata")
            .and_then(|metadata| string(metadata, "issuer"))
            != string(discovery, "authorizationServer")
    {
        return Err("OAuth discovery authorization-server issuer mismatch".into());
    }
    if let Some(session) = session {
        let issuer = session
            .get("discovery")
            .and_then(|discovery| discovery.get("authorizationServerMetadata"))
            .and_then(|metadata| string(metadata, "issuer"));
        if string(session, "resource") != Some(resource)
            || issuer != string(session, "authorizationServer")
            || discovery.is_some_and(|discovery| {
                string(discovery, "authorizationServer") != string(session, "authorizationServer")
            })
        {
            return Ok("clear");
        }
    }
    if let (Some(session), Some(configured)) = (session, configured)
        && string(configured, "mode") == Some(text("static").as_slice())
        && session
            .get("tokens")
            .is_some_and(|tokens| matches!(tokens, Value::Object(_)))
    {
        let client = normalize_client(configured, true);
        let stored = session.get("client");
        if client.is_none()
            || client
                .as_ref()
                .and_then(|client| string(client, "clientId"))
                != stored.and_then(|client| string(client, "clientId"))
            || client
                .as_ref()
                .and_then(|client| string(client, "clientSecret"))
                != stored.and_then(|client| string(client, "clientSecret"))
        {
            return Err("Stored session belongs to a different OAuth client; use separate persistence or explicitly reset it".into());
        }
    }
    Ok("keep")
}
fn resolved(client: Value, kind: &str, stored: bool) -> Value {
    Value::Object(vec![
        property("client", client),
        property("kind", Value::String(text(kind))),
        property("fromStoredRegistration", Value::Bool(stored)),
    ])
}
pub fn initial_client(options: &Value, has_registration: bool) -> Result<Value, String> {
    let configured = normalize_client(options, true);
    if string(options, "mode") == Some(text("static").as_slice()) {
        return configured
            .map(|client| resolved(client, "static", false))
            .ok_or_else(|| "OAuth client_id must not be blank".into());
    }
    if !has_registration && let Some(client) = configured {
        return Ok(resolved(client, "static", false));
    }
    Ok(Value::Object(vec![property(
        "action",
        Value::String(text("load")),
    )]))
}
pub fn dynamic_client(
    options: &Value,
    stored: Option<&Value>,
    existing: Option<&Value>,
    has_registration: bool,
) -> Result<Value, String> {
    if let Some(client) = stored {
        return Ok(resolved(client.clone(), "dynamic", true));
    }
    let existing = existing
        .and_then(|session| session.get("client"))
        .filter(|client| string(client, "clientId").is_some_and(|id| !id.is_empty()));
    if !has_registration {
        return existing
            .map(|client| resolved(client.clone(), "dynamic", true))
            .ok_or_else(|| {
                "Authorization server metadata is missing registration_endpoint".into()
            });
    }
    let configured = normalize_client(options, true);
    if let Some(client) = existing
        && configured.as_ref() != Some(client)
    {
        let mut result = resolved(client.clone(), "dynamic", true);
        let Value::Object(fields) = &mut result else {
            unreachable!()
        };
        fields.push(property("action", Value::String(text("cache"))));
        return Ok(result);
    }
    Ok(Value::Object(vec![property(
        "action",
        Value::String(text("register")),
    )]))
}
pub fn registration_body(metadata: &Value, redirect: &[u16]) -> Value {
    let mut fields = vec![
        property(
            "redirect_uris",
            Value::Array(vec![Value::String(redirect.to_vec())]),
        ),
        property(
            "grant_types",
            Value::Array(vec![
                Value::String(text("authorization_code")),
                Value::String(text("refresh_token")),
            ]),
        ),
        property(
            "response_types",
            Value::Array(vec![Value::String(text("code"))]),
        ),
        property("token_endpoint_auth_method", Value::String(text("none"))),
    ];
    for (input, output) in [
        ("clientName", "client_name"),
        ("scope", "scope"),
        ("softwareId", "software_id"),
        ("softwareVersion", "software_version"),
    ] {
        if let Some(value) = trimmed(metadata, input) {
            fields.push(property(output, Value::String(value)));
        }
    }
    Value::Object(fields)
}
pub fn registered_client(payload: &Value) -> Result<Value, String> {
    let id = trimmed(payload, "client_id")
        .ok_or("OAuth client registration response missing client_id")?;
    let mut fields = vec![property("clientId", Value::String(id))];
    if let Some(secret) = trimmed(payload, "client_secret") {
        fields.push(property("clientSecret", Value::String(secret)));
    }
    fields.push(property("registration", payload.clone()));
    if let Some(method) = payload.get("token_endpoint_auth_method") {
        fields.push(property("tokenEndpointAuthMethod", method.clone()));
    }
    Ok(Value::Object(fields))
}
pub fn authorization_plan(input: &Value, entropy: &[u8]) -> Result<Value, String> {
    let metadata = input.get("metadata").unwrap_or(&Value::Null);
    let endpoint = required(metadata, "authorization_endpoint")?;
    let issuer = required(metadata, "issuer")?;
    let require_issuer =
        metadata.get("authorization_response_iss_parameter_supported") == Some(&Value::Bool(true));
    let state = crate::state::create_authorization_state(issuer, require_issuer, entropy)
        .map_err(str::to_owned)?;
    let mut params = vec![property("response_type", Value::String(text("code")))];
    for (source, target) in [
        ("clientId", "client_id"),
        ("redirectUri", "redirect_uri"),
        ("codeChallenge", "code_challenge"),
    ] {
        params.push(property(
            target,
            input.get(source).cloned().unwrap_or(Value::Null),
        ));
    }
    params.push(property(
        "code_challenge_method",
        Value::String(text("S256")),
    ));
    params.push(property(
        "resource",
        input.get("resource").cloned().unwrap_or(Value::Null),
    ));
    params.push(property("state", Value::String(text(&state))));
    if let Some(scope) = input
        .get("clientMetadata")
        .and_then(|metadata| trimmed(metadata, "scope"))
    {
        params.push(property("scope", Value::String(scope)));
    }
    Ok(Value::Object(vec![
        property("endpoint", Value::String(endpoint.to_vec())),
        property("params", Value::Object(params)),
    ]))
}

pub fn normalize_tokens_checked(value: &Value) -> Result<Option<Value>, String> {
    if matches!(value, Value::Object(_)) {
        crate::scope::normalize(value.get("scope")).map_err(str::to_owned)?;
    }
    Ok(normalize_tokens(value))
}

pub fn same_token_grant(left: &Value, right: &Value) -> bool {
    [
        "accessToken",
        "refreshToken",
        "tokenType",
        "expiresAt",
        "scope",
    ]
    .iter()
    .all(|key| left.get(key) == right.get(key))
}
