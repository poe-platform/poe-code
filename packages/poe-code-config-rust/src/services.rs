//! Configured-service primitive admission and stable file normalization.
use mcp_protocol_rust::strings::trim_ecmascript;
use std::collections::BTreeSet;
pub fn files(values: Vec<Vec<u16>>) -> Vec<Vec<u16>> {
    let mut seen = BTreeSet::new();
    values
        .into_iter()
        .filter(|value| !value.is_empty() && seen.insert(value.clone()))
        .collect()
}
pub fn optional_text(value: &[u16]) -> Option<Vec<u16>> {
    let value = trim_ecmascript(value);
    (!value.is_empty()).then(|| value.to_vec())
}
pub fn is_api_shape(value: &[u16]) -> bool {
    [
        "openai-chat-completions",
        "openai-responses",
        "anthropic-messages",
        "google-generations",
    ]
    .iter()
    .any(|shape| value.iter().copied().eq(shape.encode_utf16()))
}
