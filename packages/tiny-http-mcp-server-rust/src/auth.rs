//! Bearer parsing, challenges, error admission and resource metadata policy.
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
fn key(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn text(s: &str) -> Value {
    Value::String(key(s))
}
fn record(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(fields.into_iter().map(|(k, v)| (key(k), v)).collect())
}
fn string(v: Option<&Value>) -> Option<&[u16]> {
    if let Some(Value::String(s)) = v {
        Some(s)
    } else {
        None
    }
}
fn matches(v: Option<&Value>, s: &str) -> bool {
    string(v).is_some_and(|v| v.iter().copied().eq(s.encode_utf16()))
}
pub fn bearer_token(value: Option<&[u16]>) -> Value {
    let Some(value) = value.filter(|v| !v.is_empty()) else {
        return record(vec![("kind", text("missing"))]);
    };
    if let Some(separator) = value.iter().position(|u| *u == 32).filter(|i| *i > 0) {
        let scheme = String::from_utf16_lossy(&value[..separator]).to_lowercase();
        let token = trim_ecmascript(&value[separator + 1..]);
        if scheme == "bearer"
            && !token.is_empty()
            && !token.iter().any(|u| matches!(*u, 9..=13 | 32))
        {
            return record(vec![
                ("kind", text("token")),
                ("token", Value::String(token.to_vec())),
            ]);
        }
    }
    record(vec![
        ("kind", text("malformed")),
        ("errorDescription", text("malformed bearer token")),
    ])
}
fn escape(value: &[u16]) -> Vec<u16> {
    let mut out = vec![];
    for u in value {
        if *u == 34 || *u == 92 {
            out.push(92)
        }
        out.push(*u)
    }
    out
}
pub fn challenge(metadata: &[u16], options: &Value) -> Vec<u16> {
    let mut out = key("Bearer realm=\"mcp\", resource_metadata=\"");
    out.extend(escape(metadata));
    out.push(34);
    for (field, name) in [
        ("error", "error"),
        ("errorDescription", "error_description"),
    ] {
        if let Some(value) = string(options.get(field)) {
            out.extend(format!(", {name}=\"").encode_utf16());
            out.extend(escape(value));
            out.push(34)
        }
    }
    if let Some(Value::Array(scopes)) = options
        .get("scope")
        .filter(|v| matches!(v,Value::Array(a) if !a.is_empty()))
    {
        out.extend(", scope=\"".encode_utf16());
        for (i, scope) in scopes.iter().enumerate() {
            if i > 0 {
                out.push(32)
            }
            if let Value::String(s) = scope {
                out.extend(escape(s))
            }
        }
        out.push(34);
    }
    out
}
pub fn normalize_error(error: &Value, required: &Value) -> Value {
    if matches(error.get("error"), "temporarily_unavailable") {
        return record(vec![("statusCode", Value::Number(503.0))]);
    }
    let insufficient = matches(error.get("error"), "insufficient_scope");
    let valid = (insufficient || matches(error.get("error"), "invalid_token"))
        && error
            .get("errorDescription")
            .is_none_or(|v| matches!(v, Value::String(_)))
        && error.get("scope").is_none_or(
            |v| matches!(v,Value::Array(a) if a.iter().all(|v|matches!(v,Value::String(_)))),
        );
    let mut fields = vec![(
        "error",
        text(if valid && insufficient {
            "insufficient_scope"
        } else {
            "invalid_token"
        }),
    )];
    if valid {
        if let Some(description) = error.get("errorDescription") {
            fields.push(("errorDescription", description.clone()))
        }
        if let Some(scope) = error
            .get("scope")
            .filter(|v| matches!(v,Value::Array(a) if !a.is_empty()))
        {
            fields.push(("scope", scope.clone()))
        } else if insufficient {
            fields.push(("scope", required.clone()))
        }
    } else {
        fields.push(("errorDescription", text("token verification failed")))
    }
    record(vec![
        (
            "statusCode",
            Value::Number(if valid && insufficient { 403.0 } else { 401.0 }),
        ),
        ("options", record(fields)),
    ])
}
pub fn scope_admission(required: &Value, verified: &Value) -> bool {
    let (Value::Array(required), Value::Array(verified)) = (required, verified) else {
        return false;
    };
    required.iter().all(|scope| verified.contains(scope))
}
pub fn metadata(options: &Value) -> Value {
    let mut fields = vec![
        (
            "resource",
            options.get("resource").cloned().unwrap_or(Value::Null),
        ),
        (
            "authorization_servers",
            options
                .get("authorizationServers")
                .cloned()
                .unwrap_or(Value::Array(vec![])),
        ),
    ];
    for (field, name) in [
        ("bearerMethodsSupported", "bearer_methods_supported"),
        ("scopesSupported", "scopes_supported"),
    ] {
        if let Some(value) = options.get(field) {
            fields.push((name, value.clone()))
        }
    }
    record(fields)
}
pub fn request_origin(headers: &Value, encrypted: bool, trusted: bool) -> Value {
    fn first(v: Option<&Value>) -> Option<&[u16]> {
        match v {
            Some(Value::String(s)) => Some(s),
            Some(Value::Array(a)) => string(a.first()),
            _ => None,
        }
    }
    let forwarded = |name| {
        first(headers.get(name))
            .map(|v| trim_ecmascript(v.split(|u| *u == 44).next().unwrap_or_default()))
    };
    let protocol = if trusted {
        forwarded("x-forwarded-proto")
            .map(|s| String::from_utf16_lossy(s).to_lowercase())
            .filter(|s| s == "https" || s == "http")
    } else {
        None
    }
    .unwrap_or_else(|| if encrypted { "https" } else { "http" }.into());
    let host = if trusted {
        forwarded("x-forwarded-host").filter(|v| !v.is_empty())
    } else {
        None
    }
    .or_else(|| first(headers.get("host")))
    .map(|s| Value::String(s.to_vec()))
    .unwrap_or_else(|| text("127.0.0.1"));
    record(vec![("protocol", text(&protocol)), ("host", host)])
}
pub fn metadata_path(path: Option<&[u16]>) -> Vec<u16> {
    let mut out = key("/.well-known/oauth-protected-resource");
    if let Some(path) = path.filter(|v| !v.is_empty() && *v != [47]) {
        if !path.starts_with(&[47]) {
            out.push(47)
        }
        let end = if path.last() == Some(&47) {
            path.len() - 1
        } else {
            path.len()
        };
        out.extend(&path[..end])
    }
    out
}
