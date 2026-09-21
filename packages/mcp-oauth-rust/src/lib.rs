//! Independent OAuth core. Binding hosts provide operating-system entropy and I/O.
pub mod base64;
mod sha256;
pub use sha256::{Sha256, sha256};

pub fn generate_code_verifier(entropy: &[u8]) -> Result<String, &'static str> {
    if entropy.len() != 32 {
        return Err("PKCE verifier requires 32 bytes of operating-system entropy");
    }
    Ok(base64::encode_url(entropy))
}
pub fn generate_code_challenge(verifier: &[u16]) -> String {
    let utf8 = char::decode_utf16(verifier.iter().copied())
        .map(|point| point.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect::<String>();
    base64::encode_url(&sha256(utf8.as_bytes()))
}
pub mod jwks;
pub mod loopback;
pub mod provider;
pub mod response;
pub mod session;
pub mod state;
pub mod tokens;

pub mod scope;

pub mod token_auth;

pub mod registration;

pub mod transaction;
