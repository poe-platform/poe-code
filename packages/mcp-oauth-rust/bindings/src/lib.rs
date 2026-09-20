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
