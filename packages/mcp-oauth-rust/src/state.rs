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
    // Web base64 decoding rejects junk and non-ASCII instead of discarding it.
    let mut encoded: Vec<u16> = text
        .iter()
        .copied()
        .filter(|unit| !matches!(unit, 9 | 10 | 12 | 13 | 32))
        .collect();
    if encoded.len().is_multiple_of(4) {
        for _ in 0..2 {
            if encoded.last() == Some(&61) {
                encoded.pop();
            } else {
                break;
            }
        }
    }
    if encoded.len() % 4 == 1
        || encoded
            .iter()
            .any(|unit| !matches!(unit, 65..=90 | 97..=122 | 48..=57 | 43 | 47 | 45 | 95))
    {
        return None;
    }
    let bytes = decode_lenient(&encoded);
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
