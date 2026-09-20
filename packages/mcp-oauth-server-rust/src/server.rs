//! Authorization-server admission and record plans. Hosts canonicalize URLs and perform effects.
use mcp_protocol_rust::{
    json::{self, Limits, Value},
    strings::trim_ecmascript,
};
use std::collections::HashSet;
#[derive(Debug)]
pub struct Error {
    pub code: Option<&'static str>,
    pub message: String,
    pub status: u16,
    pub name: Option<&'static str>,
    pub claim: Option<&'static str>,
    pub reason: Option<&'static str>,
    pub payload: Option<Box<Value>>,
}
impl Error {
    pub(crate) fn plain(message: impl Into<String>) -> Self {
        Self {
            code: None,
            message: message.into(),
            status: 400,
            name: None,
            claim: None,
            reason: None,
            payload: None,
        }
    }
    fn protocol(code: &'static str, message: &str) -> Self {
        Self {
            code: Some(code),
            ..Self::plain(message)
        }
    }
    pub fn value(&self) -> Value {
        let mut fields = vec![
            ("message", s(&self.message)),
            ("status", Value::Number(self.status as f64)),
        ];
        for (key, value) in [
            ("code", self.code),
            ("name", self.name),
            ("claim", self.claim),
            ("reason", self.reason),
        ] {
            if let Some(value) = value {
                fields.push((key, s(value)));
            }
        }
        if let Some(value) = &self.payload {
            fields.push(("payload", value.as_ref().clone()));
        }
        obj(fields)
    }
}
fn obj(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
fn s(text: &str) -> Value {
    Value::String(text.encode_utf16().collect())
}
fn field<'a>(v: &'a Value, key: &str) -> &'a Value {
    v.get(key).unwrap_or(&Value::Null)
}
fn text(v: &Value) -> Option<&[u16]> {
    match v {
        Value::String(s) => Some(s),
        _ => None,
    }
}
fn number(v: &Value) -> f64 {
    match v {
        Value::Number(n) => *n,
        _ => f64::NAN,
    }
}
fn strings(v: &Value) -> Option<Vec<Vec<u16>>> {
    match v {
        Value::Array(a) => a.iter().map(|v| text(v).map(<[u16]>::to_vec)).collect(),
        _ => None,
    }
}
fn unique(a: Vec<Vec<u16>>) -> Vec<Vec<u16>> {
    let mut seen = HashSet::new();
    a.into_iter().filter(|s| seen.insert(s.clone())).collect()
}
fn array(a: Vec<Vec<u16>>) -> Value {
    Value::Array(a.into_iter().map(Value::String).collect())
}
fn equals(v: &Value, expected: &str) -> bool {
    text(v).is_some_and(|s| s.iter().copied().eq(expected.encode_utf16()))
}
fn invalid_scope(scope: &[u16]) -> bool {
    scope.is_empty() || scope.iter().any(|u| *u <= 32 || *u == 127)
}
fn joined(scopes: &Value) -> Value {
    let mut result = Vec::new();
    for (i, scope) in strings(scopes).unwrap_or_default().iter().enumerate() {
        if i > 0 {
            result.push(32);
        }
        result.extend(scope);
    }
    Value::String(result)
}
fn parse_scopes(v: &Value) -> Result<Vec<Vec<u16>>, Error> {
    let Some(raw) = text(v) else {
        return Ok(Vec::new());
    };
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    let scopes: Vec<_> = raw.split(|u| *u == 32).map(<[u16]>::to_vec).collect();
    if scopes.iter().any(|s| invalid_scope(s)) {
        return Err(Error::protocol(
            "invalid_scope",
            "scope contains an invalid value.",
        ));
    }
    Ok(unique(scopes))
}
fn missing(v: &Value) -> bool {
    matches!(v, Value::Null)
}
fn revoked(v: &Value) -> bool {
    v.get("revokedAt").is_some()
}
fn scope_subset(requested: &Value, approved: Option<&Value>) -> Result<Value, Error> {
    let requested = strings(requested).unwrap_or_default();
    let Some(approved) = approved else {
        return Ok(array(requested));
    };
    let approved = strings(approved)
        .ok_or_else(|| Error::plain("Approved scopes must be a subset of requested scopes."))?;
    if approved.iter().any(|s| !requested.contains(s)) {
        return Err(Error::plain(
            "Approved scopes must be a subset of requested scopes.",
        ));
    }
    Ok(array(unique(approved)))
}
pub fn url_admission(info: &Value, label: &str, issuer: bool) -> Result<Value, Error> {
    if !matches!(info.get("href"), Some(Value::String(_))) {
        return Err(Error::protocol(
            "invalid_request",
            &format!("{label} must be an absolute URL."),
        ));
    }
    if !equals(field(info, "hash"), "") {
        return Err(Error::protocol(
            "invalid_request",
            &format!("{label} must not contain a fragment."),
        ));
    }
    if !issuer {
        return Ok(field(info, "href").clone());
    }
    let host = text(field(info, "hostname"))
        .map(String::from_utf16_lossy)
        .unwrap_or_default();
    let parts: Vec<_> = host.split('.').collect();
    let loopback = ["localhost", "[::1]"].contains(&host.as_str())
        || (parts.len() == 4
            && parts[0] == "127"
            && parts[1..].iter().all(|p| p.parse::<u8>().is_ok()));
    if !equals(field(info, "protocol"), "https:")
        && !(equals(field(info, "protocol"), "http:") && loopback)
    {
        return Err(Error::plain("issuer must use HTTPS unless it is loopback."));
    }
    if !equals(field(info, "username"), "") || !equals(field(info, "password"), "") {
        return Err(Error::plain("issuer must not contain credentials."));
    }
    if !equals(field(info, "pathname"), "/") || !equals(field(info, "search"), "") {
        return Err(Error::plain(
            "issuer must be an origin URL without a path or query.",
        ));
    }
    let mut href = text(field(info, "href")).unwrap().to_vec();
    if href.last() == Some(&47) {
        href.pop();
    }
    Ok(Value::String(href))
}
#[derive(Debug)]
pub struct Policy {
    issuer: Value,
    resources: Vec<Vec<u16>>,
    supported: Option<Vec<Vec<u16>>>,
    defaults: Vec<Vec<u16>>,
    access_ms: f64,
    code_ms: f64,
    transaction_ms: f64,
    refresh_ms: f64,
    pub body_limit: f64,
}
impl Policy {
    pub fn new(options: Value) -> Result<Self, Error> {
        let resources = unique(strings(field(&options, "resources")).unwrap_or_default());
        if resources.is_empty() {
            return Err(Error::plain("At least one protected resource is required."));
        }
        let supported = options
            .get("scopesSupported")
            .map(|v| unique(strings(v).unwrap_or_default()));
        let defaults = unique(strings(field(&options, "defaultScopes")).unwrap_or_default());
        if defaults.iter().any(|s| invalid_scope(s)) {
            return Err(Error::plain(
                "default scopes must contain valid scope names.",
            ));
        }
        if supported
            .as_ref()
            .is_some_and(|supported| defaults.iter().any(|s| !supported.contains(s)))
        {
            return Err(Error::plain(
                "default scopes must be included in supported scopes.",
            ));
        }
        let mut durations = Vec::new();
        for (key, default) in [
            ("accessTokenTtlSeconds", 300.0),
            ("authorizationCodeTtlSeconds", 60.0),
            ("authorizationTransactionTtlSeconds", 600.0),
            ("refreshTokenTtlSeconds", 2_592_000.0),
        ] {
            let seconds = options.get(key).map(number).unwrap_or(default);
            if !seconds.is_finite()
                || seconds.fract() != 0.0
                || !(1.0..=9_007_199_254_740_991.0).contains(&seconds)
                || seconds * 1000.0 > 9_007_199_254_740_991.0
            {
                return Err(Error::plain(format!(
                    "{key} must be a positive safe integer with a safe millisecond duration."
                )));
            }
            durations.push(seconds * 1000.0);
        }
        let body_limit = options
            .get("maxRequestBodyBytes")
            .filter(|v| !missing(v))
            .map(number)
            .unwrap_or(65_536.0);
        if !body_limit.is_finite() || body_limit.fract() != 0.0 || body_limit <= 0.0 {
            return Err(Error::plain(
                "maxRequestBodyBytes must be a positive integer.",
            ));
        }
        Ok(Self {
            issuer: field(&options, "issuer").clone(),
            resources,
            supported,
            defaults,
            access_ms: durations[0],
            code_ms: durations[1],
            transaction_ms: durations[2],
            refresh_ms: durations[3],
            body_limit,
        })
    }
    pub fn call(&self, command: &str, input: Value) -> Result<Value, Error> {
        let tx = field(&input, "transaction");
        let grant = field(&input, "grant");
        let body = field(&input, "body");
        let code = field(&input, "code");
        let now = number(field(&input, "now"));
        match command {
            "verification_key" => {
                let fail = |message: String| {
                    let mut error = Error::plain(message);
                    error.name = Some("TypeError");
                    error
                };
                let ec = equals(field(&input, "algorithm"), "ES256");
                let expected = if ec { "ECDSA" } else { "RSASSA-PKCS1-v1_5" };
                if !equals(field(&input, "name"), expected) {
                    return Err(fail(format!(
                        "CryptoKey does not support this operation, its algorithm.name must be {expected}"
                    )));
                }
                if ec && !equals(field(&input, "curve"), "P-256") {
                    return Err(fail("CryptoKey does not support this operation, its algorithm.namedCurve must be P-256".into()));
                }
                if !ec && !equals(field(&input, "hash"), "SHA-256") {
                    return Err(fail("CryptoKey does not support this operation, its algorithm.hash must be SHA-256".into()));
                }
                if !strings(field(&input, "usages")).is_some_and(|a| {
                    a.iter()
                        .any(|s| s.iter().copied().eq("verify".encode_utf16()))
                }) {
                    return Err(fail("CryptoKey does not support this operation, its usages must include verify.".into()));
                }
                let modulus = number(field(&input, "modulusLength"));
                if !ec && (modulus.is_nan() || modulus < 2048.0) {
                    return Err(fail(
                        "RS256 requires key modulusLength to be 2048 bits or larger".into(),
                    ));
                }
                Ok(Value::Null)
            }
            "signing_key" => {
                let fail = |message: &str| {
                    let mut error = Error::plain(message);
                    error.name = Some("TypeError");
                    error
                };
                if !equals(field(&input, "type"), "private") {
                    return Err(fail(
                        "KeyObject instances for asymmetric algorithm signing must be of type \"private\"",
                    ));
                }
                if equals(field(&input, "algorithm"), "ES256") {
                    if !equals(field(&input, "kind"), "ec") {
                        return Err(fail(
                            "CryptoKey does not support this operation, its algorithm.name must be ECDSA",
                        ));
                    }
                    if !["prime256v1", "P-256"]
                        .iter()
                        .any(|curve| equals(field(&input, "curve"), curve))
                    {
                        return Err(fail(
                            "CryptoKey does not support this operation, its algorithm.namedCurve must be P-256",
                        ));
                    }
                } else if equals(field(&input, "algorithm"), "RS256") {
                    if !equals(field(&input, "kind"), "rsa") {
                        return Err(fail(
                            "CryptoKey does not support this operation, its algorithm.name must be RSASSA-PKCS1-v1_5",
                        ));
                    }
                    if number(field(&input, "modulusLength")) < 2048.0 {
                        return Err(fail(
                            "RS256 requires key modulusLength to be 2048 bits or larger",
                        ));
                    }
                } else {
                    return Err(Error::plain("Unsupported signing algorithm"));
                }
                Ok(s("sha256"))
            }
            "route" => {
                let route = match (
                    text(field(&input, "method"))
                        .map(String::from_utf16_lossy)
                        .as_deref(),
                    text(field(&input, "path"))
                        .map(String::from_utf16_lossy)
                        .as_deref(),
                ) {
                    (Some("GET"), Some("/.well-known/oauth-authorization-server")) => "metadata",
                    (Some("GET"), Some("/.well-known/jwks.json")) => "jwks",
                    (Some("POST"), Some("/register")) => "register",
                    (Some("GET"), Some("/authorize")) => "authorize",
                    (Some("POST"), Some("/token")) => "token",
                    (Some("POST"), Some("/revoke")) => "revoke",
                    _ => "notFound",
                };
                Ok(s(route))
            }
            "content_type" => {
                let kind = field(&input, "kind");
                let expected = if equals(kind, "json") {
                    "application/json"
                } else {
                    "application/x-www-form-urlencoded"
                };
                let actual = text(field(&input, "value"))
                    .map(|v| trim_ecmascript(v.split(|u| *u == 59).next().unwrap_or_default()));
                if actual.is_none_or(|a| !a.iter().copied().eq(expected.encode_utf16())) {
                    return Err(Error::protocol(
                        "invalid_request",
                        if equals(kind, "json") {
                            "Expected JSON request body."
                        } else {
                            "Expected form-encoded request body."
                        },
                    ));
                }
                Ok(Value::Null)
            }
            "resource_presence" => {
                if missing(field(&input, "value")) {
                    Err(Error::protocol("invalid_target", "resource is required."))
                } else {
                    Ok(field(&input, "value").clone())
                }
            }
            "resource" => {
                if !text(field(&input, "value"))
                    .is_some_and(|v| self.resources.iter().any(|s| s == v))
                {
                    Err(Error::protocol(
                        "invalid_target",
                        "resource is not supported.",
                    ))
                } else {
                    Ok(field(&input, "value").clone())
                }
            }
            "registration_input" => {
                let payload = json::parse_utf16(text(body).unwrap_or_default(), Limits::default())
                    .map_err(|_| {
                        Error::protocol(
                            "invalid_client_metadata",
                            "Registration body must be JSON.",
                        )
                    })?;
                if !matches!(payload, Value::Object(_)) {
                    return Err(Error::protocol(
                        "invalid_client_metadata",
                        "Registration body must be an object.",
                    ));
                }
                let uris = strings(field(&payload, "redirect_uris"))
                    .filter(|a| !a.is_empty())
                    .ok_or_else(|| {
                        Error::protocol("invalid_redirect_uri", "redirect_uris is required.")
                    })?;
                Ok(obj(vec![
                    ("redirectUris", array(uris)),
                    ("payload", payload),
                ]))
            }
            "registration_metadata" => {
                let payload = field(&input, "payload");
                if payload.get("token_endpoint_auth_method").is_some()
                    && !equals(field(payload, "token_endpoint_auth_method"), "none")
                {
                    return Err(Error::protocol(
                        "invalid_client_metadata",
                        "Only public clients using token_endpoint_auth_method none are supported.",
                    ));
                }
                let grants = strings(field(payload, "grant_types"))
                    .unwrap_or_else(|| vec!["authorization_code".encode_utf16().collect()]);
                if grants.iter().any(|g| {
                    !g.iter().copied().eq("authorization_code".encode_utf16())
                        && !g.iter().copied().eq("refresh_token".encode_utf16())
                }) {
                    return Err(Error::protocol(
                        "invalid_client_metadata",
                        "Unsupported grant type.",
                    ));
                }
                let responses = strings(field(payload, "response_types"))
                    .unwrap_or_else(|| vec!["code".encode_utf16().collect()]);
                if responses.len() != 1 || !responses[0].iter().copied().eq("code".encode_utf16()) {
                    return Err(Error::protocol(
                        "invalid_client_metadata",
                        "Only response_type code is supported.",
                    ));
                }
                Ok(obj(vec![
                    (
                        "redirectUris",
                        array(unique(
                            strings(field(&input, "redirectUris")).unwrap_or_default(),
                        )),
                    ),
                    ("grantTypes", array(grants)),
                ]))
            }
            "client_record" => Ok(obj(vec![
                ("id", field(&input, "id").clone()),
                ("redirectUris", field(&input, "redirectUris").clone()),
                ("createdAt", field(&input, "now").clone()),
            ])),
            "registration_response" => {
                let client = field(&input, "client");
                Ok(obj(vec![
                    ("client_id", field(client, "id").clone()),
                    (
                        "client_id_issued_at",
                        Value::Number((number(field(client, "createdAt")) / 1000.0).floor()),
                    ),
                    ("redirect_uris", field(client, "redirectUris").clone()),
                    ("token_endpoint_auth_method", s("none")),
                    ("grant_types", field(&input, "grantTypes").clone()),
                    ("response_types", Value::Array(vec![s("code")])),
                ]))
            }
            "authorize_start" => {
                if !equals(field(&input, "response_type"), "code") {
                    return Err(Error::protocol(
                        "unsupported_response_type",
                        "response_type must be code.",
                    ));
                }
                if missing(field(&input, "client_id")) {
                    return Err(Error::protocol("invalid_request", "client_id is required."));
                }
                Ok(field(&input, "client_id").clone())
            }
            "authorize_client" => {
                if missing(field(&input, "client")) {
                    return Err(Error::protocol("unauthorized_client", "Unknown client."));
                }
                let redirect = field(field(&input, "params"), "redirect_uri");
                if missing(redirect) {
                    return Err(Error::protocol(
                        "invalid_request",
                        "redirect_uri is required.",
                    ));
                }
                Ok(redirect.clone())
            }
            "authorize_scopes" => {
                let params = field(&input, "params");
                let redirect = field(&input, "redirectUri");
                let client = field(&input, "client");
                if !strings(field(client, "redirectUris"))
                    .is_some_and(|uris| text(redirect).is_some_and(|r| uris.iter().any(|u| u == r)))
                {
                    return Err(Error::protocol(
                        "invalid_request",
                        "redirect_uri is not registered.",
                    ));
                }
                let challenge = text(field(params, "code_challenge"));
                if !challenge.is_some_and(|c| {
                    c.len() == 43 && c.iter().all(|u| matches!(u,65..=90|97..=122|48..=57|45|95))
                }) {
                    return Err(Error::protocol(
                        "invalid_request",
                        "A valid code_challenge is required.",
                    ));
                }
                if !equals(field(params, "code_challenge_method"), "S256") {
                    return Err(Error::protocol(
                        "invalid_request",
                        "code_challenge_method must be S256.",
                    ));
                }
                let scopes = if params.get("scope").is_some() {
                    parse_scopes(field(params, "scope"))?
                } else {
                    self.defaults.clone()
                };
                if !self.defaults.is_empty() && scopes.is_empty() {
                    return Err(Error::protocol("invalid_scope", "scope must not be empty."));
                }
                if self
                    .supported
                    .as_ref()
                    .is_some_and(|a| scopes.iter().any(|s| !a.contains(s)))
                {
                    return Err(Error::protocol(
                        "invalid_scope",
                        "One or more requested scopes are not supported.",
                    ));
                }
                Ok(array(scopes))
            }
            "transaction_record" => {
                let params = field(&input, "params");
                let mut fields = vec![
                    ("id", field(&input, "id").clone()),
                    ("clientId", field(params, "client_id").clone()),
                    ("redirectUri", field(&input, "redirectUri").clone()),
                    ("codeChallenge", field(params, "code_challenge").clone()),
                    ("resource", field(&input, "resource").clone()),
                    ("scopes", field(&input, "scopes").clone()),
                ];
                if let Some(state) = params.get("state") {
                    fields.push(("state", state.clone()));
                }
                fields.extend([
                    ("createdAt", field(&input, "createdAt").clone()),
                    (
                        "expiresAt",
                        Value::Number(number(field(&input, "expiresAtNow")) + self.transaction_ms),
                    ),
                ]);
                Ok(obj(fields))
            }
            "subject" => {
                if text(field(&input, "subject")).is_none_or(|s| s.is_empty()) {
                    Err(Error::plain("subject is required."))
                } else {
                    Ok(Value::Null)
                }
            }
            "complete" => {
                if missing(tx) || number(field(tx, "expiresAt")) <= now {
                    return Err(Error::plain(
                        "Authorization transaction is missing, expired, or already completed.",
                    ));
                }
                scope_subset(field(tx, "scopes"), field(&input, "input").get("scopes"))
            }
            "grant_record" => Ok(obj(vec![
                ("id", field(&input, "id").clone()),
                ("clientId", field(tx, "clientId").clone()),
                ("subject", field(&input, "subject").clone()),
                ("resource", field(tx, "resource").clone()),
                ("scopes", field(&input, "scopes").clone()),
                ("createdAt", field(&input, "now").clone()),
            ])),
            "code_record" => Ok(obj(vec![
                ("tokenHash", field(&input, "hash").clone()),
                ("grantId", field(&input, "grantId").clone()),
                ("clientId", field(tx, "clientId").clone()),
                ("subject", field(&input, "subject").clone()),
                ("redirectUri", field(tx, "redirectUri").clone()),
                ("codeChallenge", field(tx, "codeChallenge").clone()),
                ("resource", field(tx, "resource").clone()),
                ("scopes", field(&input, "scopes").clone()),
                ("expiresAt", Value::Number(now + self.code_ms)),
            ])),
            "deny" => {
                if missing(tx) {
                    Err(Error::plain(
                        "Authorization transaction is missing or already completed.",
                    ))
                } else {
                    Ok(Value::Null)
                }
            }
            "code_expiry" => {
                if missing(code) || number(field(code, "expiresAt")) <= now {
                    Err(Error::protocol(
                        "invalid_grant",
                        "Authorization code is invalid.",
                    ))
                } else {
                    Ok(Value::Null)
                }
            }
            "code_initial_binding" => {
                if field(body, "client_id") != field(code, "clientId")
                    || field(body, "redirect_uri") != field(code, "redirectUri")
                {
                    Err(Error::protocol(
                        "invalid_grant",
                        "Authorization code binding is invalid.",
                    ))
                } else {
                    Ok(Value::Null)
                }
            }
            "code_resource_binding" => {
                let verifier = text(field(body, "code_verifier")).unwrap_or_default();
                if field(&input, "resource") != field(code, "resource")
                    || !(43..=128).contains(&verifier.len())
                    || !verifier
                        .iter()
                        .all(|u| matches!(u,65..=90|97..=122|48..=57|46|95|126|45))
                {
                    return Err(Error::protocol(
                        "invalid_grant",
                        "Authorization code binding is invalid.",
                    ));
                }
                let expected = mcp_oauth_rust::base64::decode_lenient(
                    text(field(code, "codeChallenge")).unwrap_or_default(),
                );
                if expected.len() != 32 {
                    return Err(Error::protocol(
                        "invalid_grant",
                        "Authorization code binding is invalid.",
                    ));
                }
                Ok(obj(vec![
                    (
                        "actual",
                        s(&mcp_oauth_rust::generate_code_challenge(verifier)),
                    ),
                    (
                        "expected",
                        s(&mcp_oauth_rust::base64::encode_url(&expected)),
                    ),
                ]))
            }
            "code_pkce" => {
                if field(&input, "matches") != &Value::Bool(true) {
                    Err(Error::protocol(
                        "invalid_grant",
                        "Authorization code binding is invalid.",
                    ))
                } else {
                    Ok(Value::Null)
                }
            }
            "grant_valid" => {
                if missing(grant) || revoked(grant) {
                    Err(Error::protocol(
                        "invalid_grant",
                        "Authorization grant is invalid.",
                    ))
                } else {
                    Ok(Value::Bool(strings(field(grant, "scopes")).is_some_and(
                        |a| {
                            a.iter()
                                .any(|s| s.iter().copied().eq("offline_access".encode_utf16()))
                        },
                    )))
                }
            }
            "refresh_presence" => {
                if missing(field(body, "refresh_token")) {
                    Err(Error::protocol(
                        "invalid_request",
                        "refresh_token is required.",
                    ))
                } else {
                    Ok(field(body, "refresh_token").clone())
                }
            }
            "code_presence" => {
                if missing(field(body, "code")) {
                    Err(Error::protocol("invalid_request", "code is required."))
                } else {
                    Ok(field(body, "code").clone())
                }
            }
            "refresh_expiry" => Ok(Value::Number(now + self.refresh_ms)),
            "refresh_status" => Ok(s(if equals(field(&input, "status"), "rotated") {
                "use"
            } else if equals(field(&input, "status"), "replay") {
                "replay"
            } else {
                "invalid"
            })),
            "refresh_error" => Err(Error::protocol(
                "invalid_grant",
                "Refresh token is invalid or replayed.",
            )),
            "refresh_binding" => {
                let prev = field(&input, "previous");
                Ok(Value::Bool(
                    field(prev, "clientId") == field(body, "client_id")
                        && field(prev, "resource") == field(&input, "resource"),
                ))
            }
            "refresh_binding_error" => Err(Error::protocol(
                "invalid_grant",
                "Refresh token binding is invalid.",
            )),
            "grant_type" => {
                if equals(field(body, "grant_type"), "authorization_code") {
                    Ok(s("code"))
                } else if equals(field(body, "grant_type"), "refresh_token") {
                    Ok(s("refresh"))
                } else {
                    Err(Error::protocol(
                        "unsupported_grant_type",
                        "Unsupported grant_type.",
                    ))
                }
            }
            "token_plan" => {
                let expires = now + self.access_ms;
                let iat = (now / 1000.0).floor();
                let exp = (expires / 1000.0).floor();
                if !iat.is_finite() {
                    return Err(Error::plain("Invalid setIssuedAt input"));
                }
                if !exp.is_finite() {
                    return Err(Error::plain("Invalid setExpirationTime input"));
                }
                Ok(obj(vec![
                    ("expiresAt", Value::Number(expires)),
                    (
                        "header",
                        obj(vec![
                            ("alg", field(&input, "algorithm").clone()),
                            ("kid", field(&input, "keyId").clone()),
                            ("typ", s("at+jwt")),
                        ]),
                    ),
                    (
                        "payload",
                        obj(vec![
                            ("scope", joined(field(grant, "scopes"))),
                            ("client_id", field(grant, "clientId").clone()),
                            ("iss", self.issuer.clone()),
                            ("sub", field(grant, "subject").clone()),
                            ("aud", field(grant, "resource").clone()),
                            ("jti", field(&input, "tokenId").clone()),
                            ("iat", Value::Number(iat)),
                            ("exp", Value::Number(exp)),
                        ]),
                    ),
                ]))
            }
            "access_record" => Ok(obj(vec![
                ("tokenHash", field(&input, "hash").clone()),
                ("tokenId", field(&input, "tokenId").clone()),
                ("grantId", field(grant, "id").clone()),
                ("subject", field(grant, "subject").clone()),
                ("clientId", field(grant, "clientId").clone()),
                ("resource", field(grant, "resource").clone()),
                ("expiresAt", field(&input, "expiresAt").clone()),
            ])),
            "token_response" => Ok(obj(vec![
                ("access_token", field(&input, "token").clone()),
                ("token_type", s("Bearer")),
                (
                    "expires_in",
                    Value::Number((self.access_ms / 1000.0).floor()),
                ),
                ("scope", joined(field(grant, "scopes"))),
            ])),
            "refresh_record" => Ok(obj(vec![
                ("tokenHash", field(&input, "hash").clone()),
                ("familyId", field(&input, "familyId").clone()),
                ("grantId", field(grant, "id").clone()),
                ("clientId", field(grant, "clientId").clone()),
                ("subject", field(grant, "subject").clone()),
                ("resource", field(grant, "resource").clone()),
                ("scopes", field(grant, "scopes").clone()),
                ("createdAt", field(&input, "now").clone()),
                ("expiresAt", Value::Number(now + self.refresh_ms)),
                ("status", s("active")),
            ])),
            "access_resource" => {
                if !text(field(&input, "resource"))
                    .is_some_and(|v| self.resources.iter().any(|r| r == v))
                {
                    Err(Error::plain("Access token resource is not supported."))
                } else {
                    Ok(Value::Null)
                }
            }
            "access_expiry" => {
                let token = field(&input, "storedToken");
                if missing(token) || revoked(token) || number(field(token, "expiresAt")) <= now {
                    Err(Error::plain(
                        "Access token is revoked, expired, or unknown.",
                    ))
                } else {
                    Ok(Value::Null)
                }
            }
            "verify_binding" => {
                let payload = field(&input, "payload");
                let stored = field(&input, "storedToken");
                for (key, record) in [
                    ("sub", "subject"),
                    ("client_id", "clientId"),
                    ("jti", "tokenId"),
                ] {
                    if text(field(payload, key)).is_none()
                        || field(payload, key) != field(stored, record)
                    {
                        return Err(Error::plain(
                            "Access token claims do not match the authorization record.",
                        ));
                    }
                }
                if text(field(payload, "scope")).is_none()
                    || field(&input, "resource") != field(stored, "resource")
                {
                    return Err(Error::plain(
                        "Access token claims do not match the authorization record.",
                    ));
                }
                Ok(obj(vec![
                    ("subject", field(payload, "sub").clone()),
                    ("clientId", field(payload, "client_id").clone()),
                    ("resource", field(&input, "resource").clone()),
                    ("scopes", array(parse_scopes(field(payload, "scope"))?)),
                    ("tokenId", field(payload, "jti").clone()),
                    (
                        "expiresAt",
                        Value::Number((number(field(stored, "expiresAt")) / 1000.0).floor()),
                    ),
                ]))
            }
            "notify_grant" => Ok(Value::Bool(!missing(grant) && !revoked(grant))),
            "metadata" => {
                let issuer = text(&self.issuer)
                    .map(String::from_utf16_lossy)
                    .unwrap_or_default();
                let mut fields = vec![("issuer", self.issuer.clone())];
                for (key, path) in [
                    ("authorization_endpoint", "/authorize"),
                    ("token_endpoint", "/token"),
                    ("registration_endpoint", "/register"),
                    ("revocation_endpoint", "/revoke"),
                    ("jwks_uri", "/.well-known/jwks.json"),
                ] {
                    fields.push((key, s(&format!("{issuer}{path}"))));
                }
                fields.extend([
                    ("response_types_supported", Value::Array(vec![s("code")])),
                    (
                        "grant_types_supported",
                        Value::Array(vec![s("authorization_code"), s("refresh_token")]),
                    ),
                    (
                        "token_endpoint_auth_methods_supported",
                        Value::Array(vec![s("none")]),
                    ),
                    (
                        "code_challenge_methods_supported",
                        Value::Array(vec![s("S256")]),
                    ),
                ]);
                if let Some(scopes) = &self.supported {
                    fields.push(("scopes_supported", array(scopes.clone())));
                }
                fields.push(("protected_resources", array(self.resources.clone())));
                Ok(obj(fields))
            }
            _ => Err(Error::plain("Unknown authorization-server policy command")),
        }
    }
}
