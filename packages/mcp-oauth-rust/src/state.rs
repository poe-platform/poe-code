//! Authorization-state payloads contain an opaque nonce and issuer binding flags.
use crate::base64::{decode_lenient, encode_url};
use mcp_protocol_rust::json::{self, Limits, Value};
pub struct AuthorizationState {
    pub issuer: Vec<u16>,
    pub require_issuer: bool,
}
pub fn create_authorization_state(
    issuer: &[u16],
    require_issuer: bool,
    entropy: &[u8],
) -> Result<String, &'static str> {
    if entropy.len() != 16 {
        return Err("Authorization state requires 16 bytes of operating-system entropy");
    }
    let payload = Value::Object(vec![
        ("v".encode_utf16().collect(), Value::Number(1.0)),
        (
            "n".encode_utf16().collect(),
            Value::String(encode_url(entropy).encode_utf16().collect()),
        ),
        ("i".encode_utf16().collect(), Value::String(issuer.to_vec())),
        ("r".encode_utf16().collect(), Value::Bool(require_issuer)),
    ]);
    Ok(encode_url(json::stringify(&payload).as_bytes()))
}
pub fn parse_authorization_state(text: Option<&[u16]>) -> Option<AuthorizationState> {
    let text = text.filter(|text| !text.is_empty())?;
    let bytes = decode_lenient(text);
    let decoded = String::from_utf8_lossy(&bytes)
        .encode_utf16()
        .collect::<Vec<_>>();
    let payload = json::parse_utf16(&decoded, Limits::default()).ok()?;
    if payload.get("v") != Some(&Value::Number(1.0)) {
        return None;
    }
    let Value::String(nonce) = payload.get("n")? else {
        return None;
    };
    let Value::String(issuer) = payload.get("i")? else {
        return None;
    };
    let Value::Bool(require_issuer) = payload.get("r")? else {
        return None;
    };
    if nonce.is_empty() || issuer.is_empty() {
        return None;
    }
    Some(AuthorizationState {
        issuer: issuer.clone(),
        require_issuer: *require_issuer,
    })
}
