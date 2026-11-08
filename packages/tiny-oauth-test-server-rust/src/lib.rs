//! Portable OAuth test fixture. Hosts provide canonical URL facts, clock, entropy,
//! signatures and HTTP I/O; Rust owns validation, grants and replay state.
use mcp_protocol_rust::{
    json::{self, Value},
    strings::trim_ecmascript,
};
use std::collections::{HashMap, HashSet};
pub type Text = Vec<u16>;
fn u(text: &str) -> Text {
    text.encode_utf16().collect()
}
fn s(text: &str) -> Value {
    Value::String(u(text))
}
fn obj(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(fields.into_iter().map(|(k, v)| (u(k), v)).collect())
}
fn field<'a>(value: &'a Value, key: &str) -> &'a Value {
    value.get(key).unwrap_or(&Value::Null)
}
fn text(value: &Value) -> Option<&[u16]> {
    if let Value::String(text) = value {
        Some(text)
    } else {
        None
    }
}
fn number(value: &Value) -> f64 {
    if let Value::Number(n) = value {
        *n
    } else {
        f64::NAN
    }
}
fn string(value: &Value) -> String {
    String::from_utf16_lossy(text(value).unwrap_or(&[]))
}
fn strings(value: &Value) -> Option<Vec<Text>> {
    if let Value::Array(values) = value {
        values
            .iter()
            .map(|v| text(v).map(<[u16]>::to_vec))
            .collect()
    } else {
        None
    }
}
fn array(values: &[Text]) -> Value {
    Value::Array(values.iter().cloned().map(Value::String).collect())
}
fn join(values: &[Text]) -> Text {
    let mut out = Vec::new();
    for (i, value) in values.iter().enumerate() {
        if i > 0 {
            out.push(32);
        }
        out.extend(value);
    }
    out
}
fn equals(value: &Value, expected: &str) -> bool {
    text(value) == Some(&u(expected))
}
#[derive(Debug)]
pub struct Error {
    pub status: u16,
    pub error: Option<&'static str>,
    pub message: String,
    pub name: Option<&'static str>,
}
impl Error {
    fn plain(message: impl Into<String>) -> Self {
        Self {
            status: 400,
            error: None,
            message: message.into(),
            name: None,
        }
    }
    fn protocol(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: 400,
            error: Some(code),
            message: message.into(),
            name: None,
        }
    }
    pub fn value(&self) -> Value {
        let mut fields = vec![
            ("message", s(&self.message)),
            ("status", Value::Number(f64::from(self.status))),
        ];
        if let Some(error) = self.error {
            fields.push(("error", s(error)));
        }
        if let Some(name) = self.name {
            fields.push(("name", s(name)));
        }
        obj(fields)
    }
}
pub fn parse_json(text: &[u16]) -> Result<Value, Error> {
    json::parse_utf16(text, Default::default())
        .ok()
        .filter(|v| matches!(v, Value::Object(_)))
        .ok_or_else(|| Error::protocol("invalid_request", "request body must be a JSON object"))
}
fn scope(value: Option<&[u16]>) -> Vec<Text> {
    value
        .unwrap_or(&[])
        .split(|c| *c == 32)
        .map(trim_ecmascript)
        .filter(|v| !v.is_empty())
        .map(<[u16]>::to_vec)
        .collect()
}
fn valid_scope(value: &[u16]) -> bool {
    let parsed = scope(Some(value));
    !value.is_empty() && parsed.len() == 1 && parsed[0] == value
}
fn validate_scopes(values: &[Text], direct: bool) -> Result<(), Error> {
    if values.iter().any(|v| !valid_scope(v)) {
        if direct {
            Err(Error::protocol(
                "invalid_request",
                "scope entries must not contain spaces",
            ))
        } else {
            Err(Error::plain("scope entries must not contain spaces"))
        }
    } else {
        Ok(())
    }
}
fn url(info: &Value, label: &str) -> Result<Text, Error> {
    let href = text(field(info, "href")).ok_or_else(|| {
        Error::protocol(
            "invalid_request",
            format!("{label} must be an absolute URL"),
        )
    })?;
    if text(field(info, "hash")).is_some_and(|hash| !hash.is_empty()) {
        return Err(Error::protocol(
            "invalid_request",
            format!("{label} must not include a fragment"),
        ));
    }
    Ok(href.to_vec())
}
fn loopback(info: &Value) -> bool {
    if !equals(field(info, "protocol"), "http:") {
        return false;
    }
    let host = string(field(info, "hostname"));
    let host = host
        .strip_prefix('[')
        .and_then(|v| v.strip_suffix(']'))
        .unwrap_or(&host);
    if host == "::1" {
        return true;
    }
    let parts = host
        .split('.')
        .map(str::parse::<u8>)
        .collect::<Result<Vec<_>, _>>();
    matches!(parts,Ok(parts)if parts.len()==4&&parts[0]==127)
}
fn parameter(params: &Value, name: &str, required: bool) -> Result<Option<Text>, Error> {
    let mut found = None;
    if let Value::Array(pairs) = params {
        for pair in pairs {
            if let Value::Array(pair) = pair
                && pair.first().is_some_and(|key| equals(key, name))
            {
                if found.is_some() {
                    return Err(Error::protocol(
                        "invalid_request",
                        format!("{name} must appear only once"),
                    ));
                }
                found = pair.get(1).and_then(text).map(<[u16]>::to_vec);
            }
        }
    }
    if required && found.as_ref().is_none_or(Vec::is_empty) {
        return Err(Error::protocol(
            "invalid_request",
            format!("{name} is required"),
        ));
    }
    Ok(found)
}
fn require(params: &Value, name: &str) -> Result<Text, Error> {
    parameter(params, name, true).map(Option::unwrap)
}
fn pkce(value: &[u16], challenge: bool) -> bool {
    (if challenge {
        value.len() == 43
    } else {
        (43..=128).contains(&value.len())
    }) && value
        .iter()
        .all(|c| matches!(c,65..=90|97..=122|48..=57|45|46|95|126))
}
#[derive(Clone)]
struct Client {
    portless: Vec<Text>,
    scopes: Option<Vec<Text>>,
    refresh: bool,
}
struct Code {
    client: Text,
    redirect: Text,
    resource: Text,
    scopes: Vec<Text>,
    challenge: Text,
    refresh: bool,
    expires: f64,
}
struct Refresh {
    client: Text,
    resource: Text,
    scopes: Vec<Text>,
    expires: f64,
}
#[derive(Clone)]
struct Decision {
    approve: bool,
    scopes: Option<Vec<Text>>,
}
fn direct_scopes(payload: &Value, http: bool) -> Result<Vec<Text>, Error> {
    let scope_value = field(payload, "scopes");
    let scopes = if http && matches!(scope_value, Value::Null) && payload.get("scopes").is_none() {
        Vec::new()
    } else if let Value::String(value) = scope_value {
        if !http {
            return Err(Error::protocol(
                "invalid_request",
                "scope entries must not contain spaces",
            ));
        }
        scope(Some(value))
    } else {
        strings(scope_value)
            .ok_or_else(|| Error::protocol("invalid_request", "scopes must be a string or array"))?
    };
    if matches!(scope_value, Value::Array(_)) {
        validate_scopes(&scopes, true)?;
    }
    Ok(scopes)
}
enum Listener {
    Idle,
    Pending,
    Active,
}
pub struct Fixture {
    listener: Listener,
    clock_skew: f64,
    ttl: f64,
    require_dcr: bool,
    default: Decision,
    next: Option<Decision>,
    clients: HashMap<Text, Client>,
    registered: HashMap<Text, Client>,
    codes: HashMap<Text, Code>,
    refresh: HashMap<Text, Refresh>,
    verifiers: HashSet<Text>,
    revoked: HashSet<Text>,
    approvals: HashSet<Text>,
    next_client: u64,
}
impl Fixture {
    pub fn new(options: Value) -> Result<Self, Error> {
        let clock = if matches!(field(&options, "clockSkewSeconds"), Value::Null) {
            0.0
        } else {
            number(field(&options, "clockSkewSeconds"))
        };
        if !clock.is_finite() || clock < 0.0 {
            return Err(Error::plain(
                "clockSkewSeconds must be a non-negative finite number",
            ));
        }
        let ttl = if matches!(field(&options, "defaultTokenTtlSeconds"), Value::Null) {
            60.0
        } else {
            number(field(&options, "defaultTokenTtlSeconds"))
        };
        if !ttl.is_finite() || ttl.fract() != 0.0 || ttl <= 0.0 {
            return Err(Error::plain(
                "defaultTokenTtlSeconds must be a positive integer",
            ));
        }
        let settings = field(&options, "defaultAuthorization");
        let scopes = if settings.get("scopes").is_some() {
            Some(
                strings(field(settings, "scopes"))
                    .ok_or_else(|| Error::plain("scope entries must not contain spaces"))?,
            )
        } else {
            None
        };
        if let Some(scopes) = &scopes {
            validate_scopes(scopes, false)?;
        }
        Ok(Self {
            listener: Listener::Idle,
            clock_skew: clock,
            ttl,
            require_dcr: !matches!(field(&options, "requireDcr"), Value::Bool(false)),
            default: Decision {
                approve: matches!(field(settings, "autoApprove"), Value::Bool(true)),
                scopes,
            },
            next: None,
            clients: HashMap::new(),
            registered: HashMap::new(),
            codes: HashMap::new(),
            refresh: HashMap::new(),
            verifiers: HashSet::new(),
            revoked: HashSet::new(),
            approvals: HashSet::new(),
            next_client: 1,
        })
    }
    fn allowed(client: &Client, scopes: &[Text]) -> Result<(), Error> {
        if let Some(allowed) = &client.scopes {
            for scope in scopes {
                if !allowed.contains(scope) {
                    return Err(Error::protocol(
                        "invalid_scope",
                        format!("scope {} is not allowed", String::from_utf16_lossy(scope)),
                    ));
                }
            }
        }
        Ok(())
    }
    pub fn call(&mut self, command: &str, input: Value) -> Result<Value, Error> {
        match command {
            "parameter" => Ok(parameter(
                field(&input, "params"),
                &string(field(&input, "name")),
                matches!(field(&input, "required"), Value::Bool(true)),
            )?
            .map_or(Value::Null, Value::String)),
            "json" => parse_json(text(field(&input, "body")).unwrap_or(&[])),
            "url" => Ok(Value::String(url(
                field(&input, "info"),
                &string(field(&input, "label")),
            )?)),
            "issuer" => {
                let info = field(&input, "info");
                let href = url(info, "issuer")?;
                if !equals(field(info, "protocol"), "http:")
                    && !equals(field(info, "protocol"), "https:")
                {
                    return Err(Error::plain("issuer must use http or https"));
                }
                Ok(Value::String(href))
            }
            "content_type" => {
                let expected = if equals(field(&input, "kind"), "json") {
                    "application/json"
                } else {
                    "application/x-www-form-urlencoded"
                };
                let value = string(field(&input, "value"));
                if value.split(';').next().unwrap_or("").trim().to_lowercase() != expected {
                    return Err(Error::protocol(
                        "invalid_request",
                        format!("Content-Type must be {expected}"),
                    ));
                }
                Ok(Value::Null)
            }
            "endpoints" => Ok(endpoint_paths(
                text(field(&input, "pathname")).unwrap_or(&[47]),
            )),
            "metadata" => Ok(obj(vec![
                ("issuer", field(&input, "issuer").clone()),
                (
                    "authorization_endpoint",
                    field(field(&input, "urls"), "authorize").clone(),
                ),
                (
                    "token_endpoint",
                    field(field(&input, "urls"), "token").clone(),
                ),
                (
                    "registration_endpoint",
                    field(field(&input, "urls"), "register").clone(),
                ),
                ("jwks_uri", field(field(&input, "urls"), "jwks").clone()),
                ("response_types_supported", array(&[u("code")])),
                (
                    "grant_types_supported",
                    array(&[u("authorization_code"), u("refresh_token")]),
                ),
                ("token_endpoint_auth_methods_supported", array(&[u("none")])),
                ("code_challenge_methods_supported", array(&[u("S256")])),
                (
                    "authorization_response_iss_parameter_supported",
                    Value::Bool(true),
                ),
            ])),
            "token_plan" => {
                if equals(field(&input, "alg"), "RS256")
                    && number(field(&input, "modulusLength")) < 2048.0
                {
                    let mut error =
                        Error::plain("RS256 requires key modulusLength to be 2048 bits or larger");
                    error.name = Some("TypeError");
                    return Err(error);
                }
                Ok(obj(vec![
                    (
                        "header",
                        obj(vec![
                            ("alg", field(&input, "alg").clone()),
                            ("kid", field(&input, "kid").clone()),
                            ("typ", s("JWT")),
                        ]),
                    ),
                    (
                        "payload",
                        obj(vec![
                            ("client_id", field(&input, "clientId").clone()),
                            (
                                "scope",
                                Value::String(join(
                                    &strings(field(&input, "scopes")).unwrap_or_default(),
                                )),
                            ),
                            ("iss", field(&input, "issuer").clone()),
                            ("aud", field(&input, "resource").clone()),
                            ("sub", field(&input, "clientId").clone()),
                            ("iat", field(&input, "now").clone()),
                            (
                                "exp",
                                Value::Number(
                                    number(field(&input, "now"))
                                        + number(field(&input, "ttlSeconds")),
                                ),
                            ),
                            ("jti", field(&input, "random").clone()),
                        ]),
                    ),
                ]))
            }
            "token_response" => {
                let plan = field(&input, "plan");
                let mut fields = vec![
                    ("access_token", field(&input, "token").clone()),
                    ("token_type", s("Bearer")),
                    ("expires_in", field(plan, "ttlSeconds").clone()),
                ];
                if let Some(refresh) = input.get("refresh") {
                    fields.push(("refresh_token", refresh.clone()));
                }
                if let Some(scopes) = strings(field(plan, "scopes")).filter(|v| !v.is_empty()) {
                    fields.push(("scope", Value::String(join(&scopes))));
                }
                Ok(obj(fields))
            }
            "consent" => Ok(Value::String(consent_page(&input))),
            "listen_start" => {
                if !matches!(self.listener, Listener::Idle) {
                    return Err(Error::plain("OAuth test server is already listening"));
                }
                self.listener = Listener::Pending;
                Ok(Value::Null)
            }
            "listen_fail" => {
                if matches!(self.listener, Listener::Pending) {
                    self.listener = Listener::Idle;
                }
                Ok(Value::Null)
            }
            "listen_bound" => {
                if !matches!(self.listener, Listener::Pending) {
                    return Err(Error::plain("Invalid OAuth listener transition"));
                }
                self.listener = Listener::Active;
                Ok(Value::Null)
            }
            "close_needed" => Ok(Value::Bool(matches!(self.listener, Listener::Active))),
            "closed" => {
                self.listener = Listener::Idle;
                Ok(Value::Null)
            }
            "cli_options" => cli_options(&input),
            "cli_help" => Ok(Value::String(cli_help(
                text(field(&input, "name")).unwrap_or(&[]),
            ))),
            "cli_startup" => {
                let info = field(&input, "issuerInfo");
                let endpoints = endpoint_paths(text(field(info, "pathname")).unwrap_or(&[47]));
                let lines = [
                    format!(
                        "{} {}",
                        string(field(&input, "name")),
                        string(field(&input, "version"))
                    ),
                    format!("Bound URL: {}", string(field(&input, "bound"))),
                    format!("Issuer: {}", string(field(&input, "issuer"))),
                    format!(
                        "Authorization server metadata URL: {}{}",
                        string(field(info, "origin")),
                        string(field(&endpoints, "metadata"))
                    ),
                    format!(
                        "Issue token curl: curl -sS -X POST {}/testing/issue-token -H 'Content-Type: application/json' -d '{{\"client_id\":\"demo-client\",\"resource\":\"https://resource.example.com/mcp\",\"scopes\":[\"mcp.read\"]}}'",
                        string(field(&input, "bound"))
                    ),
                ];
                Ok(s(&(lines.join("\n") + "\n")))
            }
            "default_scopes" => {
                self.default.scopes = strings(field(&input, "scopes"));
                Ok(Value::Null)
            }
            "log_params" => {
                let mut seen = HashSet::new();
                let mut out = Vec::new();
                if let Value::Array(params) = field(&input, "params") {
                    for pair in params {
                        if let Value::Array(pair) = pair {
                            let name = pair.first().cloned().unwrap_or(Value::Null);
                            if equals(&name, "code_verifier") || equals(&name, "refresh_token") {
                                let key = text(&name).unwrap().to_vec();
                                if seen.insert(key) {
                                    out.push(Value::Array(vec![name, s("[redacted]")]));
                                }
                            } else {
                                out.push(Value::Array(pair.clone()));
                            }
                        }
                    }
                }
                Ok(Value::Array(out))
            }
            "stats" => Ok(obj(vec![
                ("staticClients", Value::Number(self.clients.len() as f64)),
                (
                    "registeredClients",
                    Value::Number(self.registered.len() as f64),
                ),
                ("codes", Value::Number(self.codes.len() as f64)),
                ("refreshTokens", Value::Number(self.refresh.len() as f64)),
                ("usedVerifiers", Value::Number(self.verifiers.len() as f64)),
                ("revokedTokens", Value::Number(self.revoked.len() as f64)),
                ("approvals", Value::Number(self.approvals.len() as f64)),
            ])),
            "static" => self.static_client(&input),
            "register" => self.register(&input),
            "authorize" => self.authorize(&input),
            "exchange" => self.exchange(&input),
            "refresh" => self.rotate(&input),
            "grant_type" => {
                let kind = require(field(&input, "params"), "grant_type")?;
                if kind != u("authorization_code") && kind != u("refresh_token") {
                    return Err(Error::protocol(
                        "unsupported_grant_type",
                        format!(
                            "grant_type {} is not supported",
                            String::from_utf16_lossy(&kind)
                        ),
                    ));
                }
                Ok(Value::String(kind))
            }
            "direct" => self.direct(&input),
            "remember_refresh" => {
                let token = text(field(&input, "token")).unwrap_or(&[]).to_vec();
                self.refresh.insert(
                    token,
                    Refresh {
                        client: text(field(&input, "clientId")).unwrap_or(&[]).to_vec(),
                        resource: text(field(&input, "resource")).unwrap_or(&[]).to_vec(),
                        scopes: strings(field(&input, "scopes")).unwrap_or_default(),
                        expires: number(field(&input, "now")) + 3600.0,
                    },
                );
                Ok(Value::Null)
            }
            "next" => {
                self.next = Some(Decision {
                    approve: matches!(field(&input, "autoApprove"), Value::Bool(true)),
                    scopes: strings(field(&input, "scopes")),
                });
                Ok(Value::Null)
            }
            "revoke" => {
                self.revoked
                    .insert(text(field(&input, "token")).unwrap_or(&[]).to_vec());
                Ok(Value::Null)
            }
            "revoked" => Ok(Value::Bool(
                self.revoked
                    .contains(text(field(&input, "token")).unwrap_or(&[])),
            )),
            _ => Err(Error::plain("Unknown OAuth fixture command")),
        }
    }
    fn static_client(&mut self, input: &Value) -> Result<Value, Error> {
        let payload = field(input, "payload");
        let id = text(field(payload, "clientId")).unwrap_or(&[]);
        if trim_ecmascript(id).is_empty() {
            return Err(Error::plain("staticClients[].clientId must be non-empty"));
        }
        let redirects = strings(field(payload, "redirectUris")).unwrap_or_default();
        if redirects.is_empty() {
            return Err(Error::plain(
                "staticClients[].redirectUris must be a non-empty array",
            ));
        }
        let scopes = if payload.get("scopes").is_some() {
            Some(
                strings(field(payload, "scopes"))
                    .ok_or_else(|| Error::plain("scope entries must not contain spaces"))?,
            )
        } else {
            None
        };
        if let Some(scopes) = &scopes {
            validate_scopes(scopes, false)?;
        }
        let infos = if let Value::Array(infos) = field(input, "redirects") {
            infos
        } else {
            return Err(Error::plain("Missing static redirect facts"));
        };
        for info in infos {
            url(info, "staticClients[].redirectUris[]")?;
        }
        if self.clients.contains_key(id) {
            return Err(Error::plain("staticClients[].clientId must be unique"));
        }
        let portless = infos
            .iter()
            .map(|info| text(field(info, "portless")).unwrap_or(&[]).to_vec())
            .collect();
        self.clients.insert(
            id.to_vec(),
            Client {
                portless,
                scopes,
                refresh: true,
            },
        );
        Ok(Value::Null)
    }
    fn register(&mut self, input: &Value) -> Result<Value, Error> {
        let payload = field(input, "payload");
        let redirects = strings(field(payload, "redirect_uris"))
            .filter(|values| !values.is_empty())
            .ok_or_else(|| {
                Error::protocol(
                    "invalid_redirect_uri",
                    "redirect_uris must be a non-empty array",
                )
            })?;
        let infos = if let Value::Array(infos) = field(input, "redirects") {
            infos
        } else {
            &Vec::new()
        };
        let hrefs = infos
            .iter()
            .map(|info| url(info, "redirect_uris[]"))
            .collect::<Result<Vec<_>, _>>()?;
        if hrefs.len() != redirects.len() {
            return Err(Error::protocol(
                "invalid_request",
                "redirect_uris[] must be an absolute URL",
            ));
        }
        if infos.iter().any(|info| !loopback(info)) {
            return Err(Error::protocol(
                "invalid_redirect_uri",
                "redirect_uris must use loopback HTTP origins",
            ));
        }
        let mut metadata_arrays = Vec::new();
        for (name, defaults) in [
            (
                "grant_types",
                vec![u("authorization_code"), u("refresh_token")],
            ),
            ("response_types", vec![u("code")]),
        ] {
            let values = if payload.get(name).is_none() {
                defaults
            } else {
                strings(field(payload, name))
                    .filter(|values| !values.is_empty())
                    .ok_or_else(|| {
                        Error::protocol(
                            "invalid_client_metadata",
                            format!("{name} must be a non-empty array of strings"),
                        )
                    })?
            };
            metadata_arrays.push(values);
        }
        let grants = &metadata_arrays[0];
        let responses = &metadata_arrays[1];
        if payload.get("token_endpoint_auth_method").is_some()
            && text(field(payload, "token_endpoint_auth_method")).is_none()
        {
            return Err(Error::protocol(
                "invalid_client_metadata",
                "token_endpoint_auth_method must be a string",
            ));
        }
        let method = payload
            .get("token_endpoint_auth_method")
            .and_then(text)
            .unwrap_or(&[110, 111, 110, 101]);
        if method != u("none") {
            return Err(Error::protocol(
                "invalid_client_metadata",
                format!(
                    "token_endpoint_auth_method {} is not supported",
                    String::from_utf16_lossy(method)
                ),
            ));
        }
        for grant in grants {
            if grant != &u("authorization_code") && grant != &u("refresh_token") {
                return Err(Error::protocol(
                    "invalid_client_metadata",
                    format!(
                        "grant_types {} is not supported",
                        String::from_utf16_lossy(grant)
                    ),
                ));
            }
        }
        for response in responses {
            if response != &u("code") {
                return Err(Error::protocol(
                    "invalid_client_metadata",
                    format!(
                        "response_types {} is not supported",
                        String::from_utf16_lossy(response)
                    ),
                ));
            }
        }
        let scopes = if payload.get("scope").is_some() {
            Some(scope(Some(text(field(payload, "scope")).ok_or_else(
                || Error::protocol("invalid_client_metadata", "scope must be a string"),
            )?)))
        } else {
            None
        };
        let id = u(&format!("client_{:06}", self.next_client));
        self.next_client += 1;
        let portless = infos
            .iter()
            .map(|info| text(field(info, "portless")).unwrap_or(&[]).to_vec())
            .collect();
        self.registered.insert(
            id.clone(),
            Client {
                portless,
                scopes: scopes.clone(),
                refresh: grants.contains(&u("refresh_token")),
            },
        );
        let mut fields = vec![
            ("client_id", Value::String(id)),
            ("client_id_issued_at", field(input, "now").clone()),
        ];
        for name in ["client_name"] {
            if let Some(value) = payload.get(name).and_then(text).filter(|v| !v.is_empty()) {
                fields.push((name, Value::String(value.to_vec())));
            }
        }
        fields.push(("redirect_uris", array(&hrefs)));
        if let Some(scopes) = scopes.filter(|v| !v.is_empty()) {
            fields.push(("scope", Value::String(join(&scopes))));
        }
        fields.extend([
            ("token_endpoint_auth_method", s("none")),
            ("grant_types", array(grants)),
            ("response_types", array(responses)),
        ]);
        for name in ["software_id", "software_version"] {
            if let Some(value) = payload.get(name).and_then(text).filter(|v| !v.is_empty()) {
                fields.push((name, Value::String(value.to_vec())));
            }
        }
        Ok(obj(fields))
    }
    fn authorize(&mut self, input: &Value) -> Result<Value, Error> {
        let params = field(input, "params");
        let client_id = require(params, "client_id")?;
        require(params, "redirect_uri")?;
        let redirect = url(field(input, "redirect"), "redirect_uri")?;
        let response = require(params, "response_type")?;
        let challenge = require(params, "code_challenge")?;
        let method = require(params, "code_challenge_method")?;
        require(params, "resource")?;
        let resource = url(field(input, "resource"), "resource")?;
        let state = parameter(params, "state", false)?;
        let requested = scope(parameter(params, "scope", false)?.as_deref());
        let client = if let Some(client) = self
            .clients
            .get(&client_id)
            .or_else(|| self.registered.get(&client_id))
        {
            if !client.portless.iter().any(|candidate| {
                Some(candidate.as_slice()) == text(field(field(input, "redirect"), "portless"))
            }) {
                return Err(Error::protocol(
                    "invalid_request",
                    "redirect_uri must exactly match a registered redirect URI",
                ));
            }
            client.clone()
        } else if self.require_dcr {
            return Err(Error::protocol(
                "unauthorized_client",
                "client_id must be registered before authorization",
            ));
        } else {
            Client {
                portless: Vec::new(),
                scopes: None,
                refresh: true,
            }
        };
        if !loopback(field(input, "redirect")) {
            return Err(Error::protocol(
                "invalid_request",
                "redirect_uri must use a loopback HTTP origin",
            ));
        }
        if response != u("code") {
            return Err(Error::protocol(
                "unsupported_response_type",
                "response_type must be code",
            ));
        }
        if method != u("S256") {
            return Err(Error::protocol(
                "invalid_request",
                "code_challenge_method must be S256",
            ));
        }
        if !pkce(&challenge, true) {
            return Err(Error::protocol(
                "invalid_request",
                "code_challenge must be a valid S256 value",
            ));
        }
        Self::allowed(&client, &requested)?;
        let decision = self.next.as_ref().unwrap_or(&self.default);
        let approval = parameter(params, "approval_token", false)?;
        let approve =
            decision.approve || approval.is_some_and(|token| self.approvals.remove(&token));
        let scopes = decision.scopes.clone().unwrap_or(requested);
        Self::allowed(&client, &scopes)?;
        let random = text(field(input, "random")).unwrap_or(&[]).to_vec();
        if !approve {
            self.approvals.insert(random.clone());
            return Ok(obj(vec![
                ("kind", s("consent")),
                ("clientId", Value::String(client_id)),
                ("resource", Value::String(resource)),
                ("scopes", array(&scopes)),
                ("approval", Value::String(random)),
            ]));
        }
        self.next = None;
        self.codes.insert(
            random.clone(),
            Code {
                client: client_id,
                redirect: redirect.clone(),
                resource,
                scopes,
                challenge,
                refresh: client.refresh,
                expires: number(field(input, "now")) + 300.0,
            },
        );
        let mut fields = vec![
            ("kind", s("redirect")),
            ("redirect", Value::String(redirect)),
            ("code", Value::String(random)),
        ];
        if let Some(state) = state {
            fields.push(("state", Value::String(state)));
        }
        Ok(obj(fields))
    }
    fn exchange(&mut self, input: &Value) -> Result<Value, Error> {
        let params = field(input, "params");
        let code = require(params, "code")?;
        let client = require(params, "client_id")?;
        let verifier = require(params, "code_verifier")?;
        require(params, "redirect_uri")?;
        let redirect = url(field(input, "redirect"), "redirect_uri")?;
        require(params, "resource")?;
        let resource = url(field(input, "resource"), "resource")?;
        let record = self
            .codes
            .get(&code)
            .ok_or_else(|| Error::protocol("invalid_grant", "authorization code is invalid"))?;
        if number(field(input, "now")) >= record.expires + self.clock_skew {
            self.codes.remove(&code);
            return Err(Error::protocol(
                "invalid_grant",
                "authorization code has expired",
            ));
        }
        if record.client != client {
            return Err(Error::protocol(
                "invalid_grant",
                "client_id does not match the code",
            ));
        }
        if record.redirect != redirect {
            return Err(Error::protocol(
                "invalid_grant",
                "redirect_uri does not match the code",
            ));
        }
        if record.resource != resource {
            return Err(Error::protocol(
                "invalid_grant",
                "resource does not match the code",
            ));
        }
        if !pkce(&verifier, false) {
            return Err(Error::protocol(
                "invalid_grant",
                "PKCE verifier must be 43-128 unreserved characters",
            ));
        }
        if self.verifiers.contains(&verifier) {
            return Err(Error::protocol(
                "invalid_grant",
                "PKCE verifier has already been used",
            ));
        }
        let actual = mcp_oauth_rust::generate_code_challenge(&verifier);
        if u(&actual) != record.challenge {
            return Err(Error::protocol("invalid_grant", "PKCE verifier mismatch"));
        }
        let record = self.codes.remove(&code).unwrap();
        self.verifiers.insert(verifier);
        Ok(obj(vec![
            ("clientId", Value::String(client)),
            ("resource", Value::String(resource)),
            ("scopes", array(&record.scopes)),
            ("ttlSeconds", Value::Number(self.ttl)),
            ("issueRefreshToken", Value::Bool(record.refresh)),
        ]))
    }
    fn rotate(&mut self, input: &Value) -> Result<Value, Error> {
        let params = field(input, "params");
        let token = require(params, "refresh_token")?;
        let client = require(params, "client_id")?;
        require(params, "resource")?;
        let resource = url(field(input, "resource"), "resource")?;
        if self.revoked.contains(&token) {
            return Err(Error::protocol("invalid_grant", "refresh token is invalid"));
        }
        let record = self
            .refresh
            .get(&token)
            .ok_or_else(|| Error::protocol("invalid_grant", "refresh token is invalid"))?;
        if number(field(input, "now")) >= record.expires + self.clock_skew {
            self.refresh.remove(&token);
            return Err(Error::protocol(
                "invalid_grant",
                "refresh token has expired",
            ));
        }
        if record.client != client {
            return Err(Error::protocol("invalid_grant", "client_id does not match"));
        }
        if record.resource != resource {
            return Err(Error::protocol("invalid_grant", "resource does not match"));
        }
        let record = self.refresh.remove(&token).unwrap();
        Ok(obj(vec![
            ("clientId", Value::String(client)),
            ("resource", Value::String(resource)),
            ("scopes", array(&record.scopes)),
            ("ttlSeconds", Value::Number(self.ttl)),
            ("issueRefreshToken", Value::Bool(true)),
        ]))
    }
    fn direct(&self, input: &Value) -> Result<Value, Error> {
        let payload = field(input, "payload");
        let http = matches!(field(input, "http"), Value::Bool(true));
        let id = field(payload, if http { "client_id" } else { "clientId" });
        let client = text(id)
            .filter(|id| !trim_ecmascript(id).is_empty())
            .ok_or_else(|| {
                if http {
                    Error::protocol("invalid_request", "client_id is required")
                } else {
                    Error::plain("clientId must be non-empty")
                }
            })?;
        if http {
            text(field(payload, "resource"))
                .filter(|v| !v.is_empty())
                .ok_or_else(|| Error::protocol("invalid_request", "resource is required"))?;
        }
        let canonical = if http {
            None
        } else {
            Some(url(field(input, "resource"), "resource")?)
        };
        let mut scopes = if http {
            Some(direct_scopes(payload, http)?)
        } else {
            None
        };
        let ttl_key = if http { "ttl_seconds" } else { "ttlSeconds" };
        let ttl = if payload.get(ttl_key).is_none()
            || (!http && matches!(field(payload, ttl_key), Value::Null))
        {
            self.ttl
        } else {
            number(field(payload, ttl_key))
        };
        if !ttl.is_finite() || ttl.fract() != 0.0 || ttl <= 0.0 {
            return Err(if http {
                Error::protocol("invalid_request", "ttl_seconds must be a positive integer")
            } else {
                Error::plain("ttlSeconds must be a positive integer")
            });
        }
        let resource = match canonical {
            Some(value) => value,
            None => url(field(input, "resource"), "resource")?,
        };
        if scopes.is_none() {
            scopes = Some(direct_scopes(payload, http)?);
        }
        let scopes = scopes.unwrap();
        Ok(obj(vec![
            ("clientId", Value::String(client.to_vec())),
            ("resource", Value::String(resource)),
            ("scopes", array(&scopes)),
            ("ttlSeconds", Value::Number(ttl)),
        ]))
    }
}

fn endpoint_paths(path: &[u16]) -> Value {
    let base = if path == [47] || path.is_empty() {
        &[][..]
    } else if path.last() == Some(&47) {
        &path[..path.len() - 1]
    } else {
        path
    };
    let mut fields = Vec::new();
    let mut metadata = u("/.well-known/oauth-authorization-server");
    metadata.extend(base);
    fields.push(("metadata", Value::String(metadata)));
    for (key, suffix) in [
        ("authorize", "/authorize"),
        ("token", "/token"),
        ("register", "/register"),
        ("jwks", "/.well-known/jwks.json"),
        ("issue", "/testing/issue-token"),
    ] {
        let mut path = base.to_vec();
        path.extend(u(suffix));
        fields.push((key, Value::String(path)));
    }
    obj(fields)
}
fn html(text: &[u16]) -> Text {
    let mut output = Vec::new();
    for unit in text {
        match unit {
            38 => output.extend(u("&amp;")),
            60 => output.extend(u("&lt;")),
            62 => output.extend(u("&gt;")),
            34 => output.extend(u("&quot;")),
            39 => output.extend(u("&#39;")),
            _ => output.push(*unit),
        }
    }
    output
}
fn consent_page(input: &Value) -> Text {
    let decision = field(input, "decision");
    let scopes = strings(field(decision, "scopes")).unwrap_or_default();
    let summary = if scopes.is_empty() {
        u("(no scopes requested)")
    } else {
        join(&scopes)
    };
    let mut out = u(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Tiny OAuth Test Server</title></head><body><main><h1>Authorize test client</h1>",
    );
    for (label, value) in [
        ("Client", text(field(decision, "clientId")).unwrap_or(&[])),
        ("Resource", text(field(decision, "resource")).unwrap_or(&[])),
        ("Scopes", summary.as_slice()),
    ] {
        out.extend(u(&format!("<p><strong>{label}:</strong> ")));
        out.extend(html(value));
        out.extend(u("</p>"));
    }
    out.extend(u("<p><a href=\""));
    out.extend(html(text(field(input, "approval")).unwrap_or(&[])));
    out.extend(u("\">Approve</a></p></main></body></html>"));
    out
}

fn cli_number(values: &Value, key: &str, default: f64, port: bool) -> Result<f64, Error> {
    let Some(value) = values.get(key) else {
        return Ok(default);
    };
    let value = text(value).unwrap_or(&[]);
    let parsed = String::from_utf16_lossy(value)
        .parse::<f64>()
        .unwrap_or(f64::NAN);
    if value.is_empty()
        || value.iter().any(|c| !matches!(c, 48..=57))
        || !parsed.is_finite()
        || parsed.fract() != 0.0
        || (if port {
            !(0.0..=65535.0).contains(&parsed)
        } else {
            parsed <= 0.0
        })
    {
        return Err(Error::plain(if port {
            "--port must be an integer between 0 and 65535.".into()
        } else {
            format!("--{key} must be a positive integer.")
        }));
    }
    Ok(parsed)
}
fn cli_options(input: &Value) -> Result<Value, Error> {
    let values = field(input, "values");
    let port = cli_number(values, "port", 0.0, true)?;
    let issuer = if values.get("issuer").is_some() {
        Some(
            text(field(field(input, "issuerInfo"), "href"))
                .ok_or_else(|| Error::plain("--issuer must be an absolute URL."))?
                .to_vec(),
        )
    } else {
        None
    };
    let ttl = cli_number(values, "ttl-seconds", 60.0, false)?;
    let mut clients = Vec::new();
    for raw in strings(field(values, "static-client")).unwrap_or_default() {
        let sep = raw
            .iter()
            .position(|c| *c == 58)
            .filter(|i| *i > 0 && *i + 1 < raw.len())
            .ok_or_else(|| {
                Error::plain(
                    "--static-client must use client_id:redirect_uri[,redirect_uri...] format.",
                )
            })?;
        let redirects = raw[sep + 1..]
            .split(|c| *c == 44)
            .map(trim_ecmascript)
            .filter(|v| !v.is_empty())
            .map(<[u16]>::to_vec)
            .collect::<Vec<_>>();
        if redirects.is_empty() {
            return Err(Error::plain(
                "--static-client must include at least one redirect_uri.",
            ));
        }
        clients.push(obj(vec![
            ("clientId", Value::String(raw[..sep].to_vec())),
            ("redirectUris", array(&redirects)),
        ]));
    }
    let mut fields = vec![
        (
            "help",
            Value::Bool(matches!(field(values, "help"), Value::Bool(true))),
        ),
        ("port", Value::Number(port)),
        (
            "hostname",
            values
                .get("hostname")
                .cloned()
                .unwrap_or_else(|| s("127.0.0.1")),
        ),
        ("ttlSeconds", Value::Number(ttl)),
        (
            "autoApprove",
            Value::Bool(matches!(field(values, "auto-approve"), Value::Bool(true))),
        ),
        ("staticClients", Value::Array(clients)),
    ];
    if let Some(issuer) = issuer {
        fields.push(("issuer", Value::String(issuer)));
    }
    Ok(obj(fields))
}
fn cli_help(name: &[u16]) -> Text {
    let mut help = u("Usage: ");
    help.extend(name);
    help.extend(u(" [options]\n\nOptions:\n  --port <port>                               Port to listen on (default: 0, ephemeral)\n  --hostname <hostname>                       Hostname to bind to (default: 127.0.0.1)\n  --issuer <url>                              Issuer URL to publish in metadata and tokens\n  --ttl-seconds <seconds>                     Access token TTL in seconds (default: 60)\n  --auto-approve                              Auto-approve every authorization request\n  --static-client <client_id:redirect_uri[,redirect_uri...]>\n                                             Register a repeatable static client\n  -h, --help                                  Show this help message"));
    help
}
