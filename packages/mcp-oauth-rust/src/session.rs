//! Admission rules for persisted OAuth sessions and registrations.
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
fn object(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Object(_)))
}
fn nonblank(value: Option<&Value>) -> bool {
    matches!(value,Some(Value::String(text)) if !trim_ecmascript(text).is_empty())
}
pub fn validate_session(value: &Value) -> bool {
    if !nonblank(value.get("resource")) || !nonblank(value.get("authorizationServer")) {
        return false;
    }
    let Some(client) = value.get("client") else {
        return false;
    };
    if !nonblank(client.get("clientId"))
        || client
            .get("clientSecret")
            .is_some_and(|value| !nonblank(Some(value)))
    {
        return false;
    }
    let Some(discovery) = value.get("discovery") else {
        return false;
    };
    if !nonblank(discovery.get("resourceMetadataUrl"))
        || !object(discovery.get("resourceMetadata"))
        || !object(discovery.get("authorizationServerMetadata"))
    {
        return false;
    }
    let Some(tokens) = value.get("tokens") else {
        return true;
    };
    if !nonblank(tokens.get("accessToken"))
        || !matches!(tokens.get("tokenType"),Some(Value::String(text)) if text.iter().copied().eq("Bearer".encode_utf16()))
    {
        return false;
    }
    let valid_date = match tokens.get("expiresAt") {
        Some(Value::Null) => true,
        Some(Value::Number(number)) => {
            number.is_finite() && number.fract() == 0.0 && number.abs() <= 8_640_000_000_000_000.0
        }
        _ => false,
    };
    valid_date
        && ["refreshToken", "scope"]
            .iter()
            .all(|key| tokens.get(key).is_none_or(|value| nonblank(Some(value))))
}
pub fn read_stored_client(value: &Value) -> Result<Value, &'static str> {
    let Some(Value::String(client)) = value.get("clientId") else {
        return Err("Stored OAuth client must be a JSON object with clientId");
    };
    let mut fields = vec![(
        "clientId".encode_utf16().collect(),
        Value::String(client.clone()),
    )];
    if let Some(secret) = value.get("clientSecret") {
        fields.push(("clientSecret".encode_utf16().collect(), secret.clone()));
    }
    Ok(Value::Object(fields))
}
