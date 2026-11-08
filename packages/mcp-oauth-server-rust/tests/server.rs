use mcp_oauth_server_rust::server::Policy;
use mcp_protocol_rust::json::{self, Limits, Value};
fn v(text: &str) -> Value {
    json::parse(text.as_bytes(), Limits::default()).unwrap()
}
fn policy() -> Policy {
    Policy::new(v(r#"{"issuer":"https://auth.example","resources":["https://resource.example/mcp"],"scopesSupported":["read","offline_access"],"defaultScopes":["read"]}"#)).unwrap()
}
#[test]
fn configuration_deduplicates_scopes_and_rejects_unsafe_ttl_values() {
    assert!(
        Policy::new(v(
            r#"{"issuer":"https://auth.example","resources":[],"accessTokenTtlSeconds":0}"#
        ))
        .is_err()
    );
    assert!(Policy::new(v(r#"{"issuer":"https://auth.example","resources":["resource"],"accessTokenTtlSeconds":9007199254740991}"#)).is_err());
    assert!(Policy::new(v(r#"{"issuer":"https://auth.example","resources":["resource"],"defaultScopes":["bad scope"]}"#)).is_err());
}
#[test]
fn registration_requires_redirects_before_metadata_and_deduplicates_normalized_uris() {
    let p = policy();
    assert_eq!(
        p.call("registration_input", v(r#"{"body":"{}"}"#))
            .unwrap_err()
            .code,
        Some("invalid_redirect_uri")
    );
    let result=p.call("registration_metadata",v(r#"{"payload":{"grant_types":["authorization_code","refresh_token"]},"redirectUris":["https://example/","https://example/"]}"#)).unwrap();
    assert_eq!(
        result.get("redirectUris"),
        Some(&v(r#"["https://example/"]"#))
    );
    assert_eq!(
        p.call(
            "registration_metadata",
            v(r#"{"payload":{"token_endpoint_auth_method":"secret"},"redirectUris":[]}"#)
        )
        .unwrap_err()
        .code,
        Some("invalid_client_metadata")
    );
}
#[test]
fn authorization_checks_client_before_redirect_and_scope_before_resource() {
    let p = policy();
    assert_eq!(
        p.call("authorize_start", v(r#"{"response_type":"token"}"#))
            .unwrap_err()
            .code,
        Some("unsupported_response_type")
    );
    assert_eq!(
        p.call("authorize_client", v(r#"{"params":{},"client":null}"#))
            .unwrap_err()
            .code,
        Some("unauthorized_client")
    );
    let args = v(
        r#"{"params":{"code_challenge":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","code_challenge_method":"S256","scope":"read  read"},"client":{"redirectUris":["https://example/"]},"redirectUri":"https://example/"}"#,
    );
    assert_eq!(
        p.call("authorize_scopes", args).unwrap_err().code,
        Some("invalid_scope")
    );
}
#[test]
fn code_binding_short_circuit_precedes_resource_and_pkce_uses_s256() {
    let p = policy();
    assert_eq!(p.call("code_initial_binding",v(r#"{"code":{"clientId":"client","redirectUri":"https://example/"},"body":{"client_id":"other"}}"#)).unwrap_err().code,Some("invalid_grant"));
    let challenge =
        mcp_oauth_rust::generate_code_challenge(&"v".repeat(43).encode_utf16().collect::<Vec<_>>());
    let args = v(&format!(
        r#"{{"code":{{"resource":"https://resource.example/mcp","codeChallenge":"{challenge}"}},"resource":"https://resource.example/mcp","body":{{"code_verifier":"{}"}}}}"#,
        "v".repeat(43)
    ));
    let result = p.call("code_resource_binding", args).unwrap();
    assert_eq!(result.get("actual"), result.get("expected"));
}
#[test]
fn approved_scopes_are_narrowed_and_transaction_expiry_is_checked_first() {
    let p = policy();
    let valid = v(
        r#"{"transaction":{"expiresAt":200,"scopes":["read","offline_access"]},"input":{"subject":"s","scopes":["read","read"]},"now":100}"#,
    );
    assert_eq!(p.call("complete", valid).unwrap(), v(r#"["read"]"#));
    let expired = v(
        r#"{"transaction":{"expiresAt":100,"scopes":["read"]},"input":{"subject":"s","scopes":["other"]},"now":100}"#,
    );
    assert_eq!(
        p.call("complete", expired).unwrap_err().message,
        "Authorization transaction is missing, expired, or already completed."
    );
}
#[test]
fn token_claim_plan_uses_millisecond_records_and_second_jwt_dates() {
    let p = policy();
    let result=p.call("token_plan",v(r#"{"grant":{"id":"g","clientId":"c","subject":"s","resource":"https://resource.example/mcp","scopes":["read"]},"now":1001,"tokenId":"j","algorithm":"ES256","keyId":"k"}"#)).unwrap();
    assert_eq!(result.get("expiresAt"), Some(&Value::Number(301001.0)));
    assert_eq!(
        result.get("payload").unwrap().get("iat"),
        Some(&Value::Number(1.0))
    );
    assert_eq!(
        result.get("payload").unwrap().get("exp"),
        Some(&Value::Number(301.0))
    );
}
