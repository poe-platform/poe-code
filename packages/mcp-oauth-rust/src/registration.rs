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
