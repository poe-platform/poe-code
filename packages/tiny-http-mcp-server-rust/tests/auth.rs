use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_http_mcp_server_rust::auth::{bearer_token, challenge, normalize_error};
fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn v(s: &str) -> Value {
    json::parse(s.as_bytes(), Limits::default()).unwrap()
}
#[test]
fn bearer_token_handles_ascii_whitespace_and_ecmascript_trim() {
    assert_eq!(bearer_token(None), v(r#"{"kind":"missing"}"#));
    assert_eq!(
        bearer_token(Some(&units("bEaReR \u{feff}opaque\u{00a0}"))),
        v(r#"{"kind":"token","token":"opaque"}"#)
    );
    for s in [
        "Bearer",
        "Basic value",
        "Bearer a b",
        "Bearer a\tb",
        "Bearer ",
    ] {
        assert_eq!(
            bearer_token(Some(&units(s))).get("kind"),
            Some(&v("\"malformed\""))
        );
    }
}
#[test]
fn challenge_escapes_quotes_and_backslashes_and_omits_empty_scopes() {
    let out = challenge(
        &units("https://resource/metadata"),
        &v(r#"{"error":"invalid_token","errorDescription":"quote\"slash\\","scope":[]}"#),
    );
    assert_eq!(
        out,
        units(
            "Bearer realm=\"mcp\", resource_metadata=\"https://resource/metadata\", error=\"invalid_token\", error_description=\"quote\\\"slash\\\\\""
        )
    );
}
#[test]
fn structured_verifier_errors_preserve_scopes_and_unavailable_status() {
    let required = v(r#"["read"]"#);
    assert_eq!(
        normalize_error(&v(r#"{"error":"temporarily_unavailable"}"#), &required).get("statusCode"),
        Some(&Value::Number(503.0))
    );
    let out = normalize_error(
        &v(r#"{"error":"insufficient_scope","scope":[]}"#),
        &required,
    );
    assert_eq!(out.get("statusCode"), Some(&Value::Number(403.0)));
    assert_eq!(out.get("options").unwrap().get("scope"), Some(&required));
    let out = normalize_error(
        &v(r#"{"error":"insufficient_scope","scope":[1]}"#),
        &required,
    );
    assert_eq!(out.get("statusCode"), Some(&Value::Number(401.0)));
}
