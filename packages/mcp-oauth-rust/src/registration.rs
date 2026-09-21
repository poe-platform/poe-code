//! Bounded RFC7591 registration admission, preserving provider JSON extensions.
use mcp_protocol_rust::{
    json::{self, Value},
    strings::trim_ecmascript,
};
const INVALID: &str = "Invalid OAuth client registration metadata";
fn bounded(value: &Value, depth: usize, nodes: &mut usize) -> bool {
    *nodes += 1;
    if depth > 64 || *nodes > 20_000 {
        return false;
    }
    match value {
        Value::Number(number) => number.is_finite(),
        Value::Array(values) => values.iter().all(|value| bounded(value, depth + 1, nodes)),
        Value::Object(fields) => fields
            .iter()
            .all(|(_, value)| bounded(value, depth + 1, nodes)),
        _ => true,
    }
}
pub fn validate(value: &Value) -> Result<(), &'static str> {
    if !bounded(value, 0, &mut 0) || !matches!(value, Value::Object(_)) {
        return Err(INVALID);
    }
    if !matches!(value.get("client_id"),Some(Value::String(id))if !trim_ecmascript(id).is_empty()) {
        return Err("OAuth client registration response missing client_id");
    }
    for key in [
        "client_id",
        "client_secret",
        "token_endpoint_auth_method",
        "application_type",
        "client_name",
        "client_uri",
        "logo_uri",
        "scope",
        "tos_uri",
        "policy_uri",
        "jwks_uri",
        "software_id",
        "software_version",
        "software_statement",
        "registration_access_token",
        "registration_client_uri",
        "issuer",
    ] {
        if value
            .get(key)
            .is_some_and(|value| !matches!(value, Value::Null | Value::String(_)))
        {
            return Err(INVALID);
        }
    }
    if matches!(value.get("client_secret"),Some(Value::String(secret))if trim_ecmascript(secret).is_empty())
    {
        return Err(INVALID);
    }
    for key in ["redirect_uris", "grant_types", "response_types", "contacts"] {
        if value.get(key).is_some_and(|value|!matches!(value,Value::Null)&&!matches!(value,Value::Array(values)if values.iter().all(|value|matches!(value,Value::String(_))))){return Err(INVALID);}
    }
    for key in ["client_id_issued_at", "client_secret_expires_at"] {
        if value.get(key).is_some_and(|value|!matches!(value,Value::Null)&&!matches!(value,Value::Number(number)if number.fract()==0.0&&(0.0..=9_007_199_254_740_991.0).contains(number))){return Err(INVALID);}
    }
    crate::scope::normalize(
        value
            .get("scope")
            .filter(|value| !matches!(value, Value::Null)),
    )
    .map_err(|_| INVALID)?;
    if json::stringify(value).len() > 64 * 1024 {
        return Err(INVALID);
    }
    Ok(())
}

/// Normalize persisted client identity and retain an owned, validated registration.
pub fn normalize_stored(value: &Value) -> Result<Option<Value>, &'static str> {
    let Value::Object(_) = value else {
        return Ok(None);
    };
    let Some(Value::String(id)) = value.get("clientId") else {
        return Ok(None);
    };
    let id = trim_ecmascript(id);
    if id.is_empty() {
        return Ok(None);
    }
    let secret = match value.get("clientSecret") {
        None => None,
        Some(Value::String(secret)) if !trim_ecmascript(secret).is_empty() => {
            Some(trim_ecmascript(secret))
        }
        _ => return Ok(None),
    };
    let field = |key: &str, value| (key.encode_utf16().collect(), value);
    let mut fields = vec![field("clientId", Value::String(id.to_vec()))];
    if let Some(secret) = secret {
        fields.push(field("clientSecret", Value::String(secret.to_vec())));
    }
    let method = crate::token_auth::normalize(value.get("tokenEndpointAuthMethod"))?;
    let mut registered_method = None;
    if let Some(registration) = value.get("registration") {
        validate(registration)?;
        let Some(Value::String(registered_id)) = registration.get("client_id") else {
            unreachable!("validated registration");
        };
        let registered_secret = match registration.get("client_secret") {
            Some(Value::String(secret)) => Some(trim_ecmascript(secret)),
            _ => None,
        };
        if trim_ecmascript(registered_id) != id || registered_secret != secret {
            return Err("OAuth client registration does not match the client identity");
        }
        fields.push(field("registration", registration.clone()));
        registered_method =
            crate::token_auth::normalize(registration.get("token_endpoint_auth_method"))?;
        if method.is_some() && registered_method.is_some() && method != registered_method {
            return Err(
                "OAuth token endpoint authentication conflicts with the client registration",
            );
        }
    }
    if let Some(method) = method.or(registered_method) {
        let method = match method {
            crate::token_auth::Method::None => "none",
            crate::token_auth::Method::Post => "client_secret_post",
            crate::token_auth::Method::Basic => "client_secret_basic",
        };
        fields.push(field(
            "tokenEndpointAuthMethod",
            Value::String(method.encode_utf16().collect()),
        ));
    }
    Ok(Some(Value::Object(fields)))
}
