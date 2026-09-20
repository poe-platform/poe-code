use napi::bindgen_prelude::*;
use napi_derive::napi;
#[napi]
pub fn encode_code_verifier(entropy: Buffer) -> Result<String> {
    mcp_oauth_rust::generate_code_verifier(&entropy).map_err(napi::Error::from_reason)
}
#[napi]
pub fn generate_code_challenge(verifier: Utf16String) -> String {
    mcp_oauth_rust::generate_code_challenge(&verifier)
}
#[napi]
pub fn hash_bytes(bytes: Buffer) -> Buffer {
    mcp_oauth_rust::sha256(&bytes).to_vec().into()
}

#[path = "../../../mcp-protocol-rust/bindings/src/convert.rs"]
mod convert;
use mcp_protocol_rust::json::Value;
#[napi]
pub fn create_authorization_state(
    issuer: Utf16String,
    require_issuer: bool,
    entropy: Buffer,
) -> Result<String> {
    mcp_oauth_rust::state::create_authorization_state(&issuer, require_issuer, &entropy)
        .map_err(napi::Error::from_reason)
}
#[napi]
pub fn parse_authorization_state(text: Option<Utf16String>) -> convert::NativeJson {
    let parsed =
        mcp_oauth_rust::state::parse_authorization_state(text.as_ref().map(|text| text.as_ref()));
    convert::NativeJson(match parsed {
        Some(parsed) => Value::Object(vec![
            (
                "issuer".encode_utf16().collect(),
                Value::String(parsed.issuer),
            ),
            (
                "requireIssuer".encode_utf16().collect(),
                Value::Bool(parsed.require_issuer),
            ),
        ]),
        None => Value::Null,
    })
}

#[napi]
pub fn decode_authorization_bytes(text: Utf16String) -> Buffer {
    mcp_oauth_rust::base64::decode_lenient(&text).into()
}
