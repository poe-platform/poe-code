use mcp_oauth_server_rust::jwt::Jws;
use mcp_protocol_rust::json::{self, Limits, Value};
fn v(text: &str) -> Value {
    json::parse(text.as_bytes(), Limits::default()).unwrap()
}
fn token(header: &str, payload: &str) -> Vec<u16> {
    format!(
        "{}.{}.AA",
        mcp_oauth_rust::base64::encode_url(header.as_bytes()),
        mcp_oauth_rust::base64::encode_url(payload.as_bytes())
    )
    .encode_utf16()
    .collect()
}
#[test]
fn jws_allows_supported_critical_b64_true_and_rejects_unrecognized_headers() {
    assert!(
        Jws::new(
            &token(r#"{"alg":"ES256","crit":["b64"],"b64":true}"#, "{}"),
            "ES256"
        )
        .is_ok()
    );
    assert_eq!(
        Jws::new(
            &token(r#"{"alg":"ES256","crit":["future"],"future":true}"#, "{}"),
            "ES256"
        )
        .unwrap_err()
        .name,
        Some("JOSENotSupported")
    );
    assert_eq!(
        Jws::new(&token(r#"{"alg":"RS256"}"#, "{}"), "ES256")
            .unwrap_err()
            .name,
        Some("JOSEAlgNotAllowed")
    );
}
#[test]
fn jwt_claims_require_issuer_audience_and_type_but_exp_is_optional() {
    let jwt = Jws::new(
        &token(
            r#"{"alg":"ES256","typ":"at+jwt"}"#,
            r#"{"iss":"issuer","aud":[12,"resource"],"scope":"read"}"#,
        ),
        "ES256",
    )
    .unwrap();
    assert_eq!(
        jwt.claims(
            &"issuer".encode_utf16().collect::<Vec<_>>(),
            &"resource".encode_utf16().collect::<Vec<_>>(),
            100.0
        )
        .unwrap(),
        v(r#"{"iss":"issuer","aud":[12,"resource"],"scope":"read"}"#)
    );
    let expired = Jws::new(
        &token(
            r#"{"alg":"ES256","typ":"at+jwt"}"#,
            r#"{"iss":"issuer","aud":"resource","exp":100}"#,
        ),
        "ES256",
    )
    .unwrap();
    assert_eq!(
        expired
            .claims(
                &"issuer".encode_utf16().collect::<Vec<_>>(),
                &"resource".encode_utf16().collect::<Vec<_>>(),
                100.0
            )
            .unwrap_err()
            .name,
        Some("JWTExpired")
    );
}
