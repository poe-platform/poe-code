use mcp_protocol_rust::json::{self, Value};
use tiny_oauth_test_server_rust::{Fixture, parse_json};
fn v(text: &str) -> Value {
    json::parse(text.as_bytes(), Default::default()).unwrap()
}
#[test]
fn constructor_rejects_invalid_lifetimes_scopes_and_duplicate_static_ids() {
    for (options, message) in [
        (
            r#"{"clockSkewSeconds":-1}"#,
            "clockSkewSeconds must be a non-negative finite number",
        ),
        (
            r#"{"defaultTokenTtlSeconds":0}"#,
            "defaultTokenTtlSeconds must be a positive integer",
        ),
        (
            r#"{"defaultAuthorization":{"scopes":["a b"]}}"#,
            "scope entries must not contain spaces",
        ),
    ] {
        assert_eq!(Fixture::new(v(options)).err().unwrap().message, message);
    }
    assert!(parse_json(&"[]".encode_utf16().collect::<Vec<_>>()).is_err());
}
#[test]
fn registration_authorization_and_single_use_code_state_are_native() {
    let mut fixture = Fixture::new(v(r#"{"defaultAuthorization":{"autoApprove":true}}"#)).unwrap();
    let registration=fixture.call("register",v(r#"{"payload":{"redirect_uris":["http://127.0.0.1:100/cb"],"scope":"read"},"redirects":[{"href":"http://127.0.0.1:100/cb","portless":"http://127.0.0.1/cb","hash":"","protocol":"http:","hostname":"127.0.0.1"}],"now":100}"#)).unwrap();
    assert_eq!(
        registration.get("client_id"),
        Some(&v(r#""client_000001""#))
    );
    let params = v(
        r#"{"params":[["client_id","client_000001"],["redirect_uri","http://127.0.0.1:101/cb"],["response_type","code"],["code_challenge","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],["code_challenge_method","S256"],["resource","http://resource/mcp"],["scope","read"]],"redirect":{"href":"http://127.0.0.1:101/cb","portless":"http://127.0.0.1/cb","hash":"","protocol":"http:","hostname":"127.0.0.1"},"resource":{"href":"http://resource/mcp","hash":""},"now":100,"random":"code"}"#,
    );
    let response = fixture.call("authorize", params).unwrap();
    assert_eq!(response.get("kind"), Some(&v(r#""redirect""#)));
    fixture.call("revoke", v(r#"{"token":"token"}"#)).unwrap();
    assert_eq!(
        fixture.call("revoked", v(r#"{"token":"token"}"#)).unwrap(),
        Value::Bool(true)
    );
}
#[test]
fn duplicate_parameters_content_types_and_url_fragments_return_protocol_errors() {
    let mut fixture = Fixture::new(v("{}")).unwrap();
    assert_eq!(
        fixture
            .call(
                "parameter",
                v(r#"{"params":[["code","one"],["code","two"]],"name":"code","required":true}"#)
            )
            .unwrap_err()
            .message,
        "code must appear only once"
    );
    assert_eq!(
        fixture
            .call("content_type", v(r#"{"kind":"json","value":"text/plain"}"#))
            .unwrap_err()
            .message,
        "Content-Type must be application/json"
    );
    assert_eq!(
        fixture
            .call(
                "url",
                v(r##"{"info":{"href":"http://example/#x","hash":"#x"},"label":"resource"}"##)
            )
            .unwrap_err()
            .message,
        "resource must not include a fragment"
    );
}
#[test]
fn token_metadata_and_response_plans_have_sdk_claim_order_and_optional_fields() {
    let mut fixture = Fixture::new(v("{}")).unwrap();
    let plan=fixture.call("token_plan",v(r#"{"issuer":"http://issuer","clientId":"c","resource":"http://resource/","scopes":["read"],"ttlSeconds":60,"now":100,"random":"jti","alg":"ES256","kid":"key"}"#)).unwrap();
    assert_eq!(
        json::stringify(&plan),
        r#"{"header":{"alg":"ES256","kid":"key","typ":"JWT"},"payload":{"client_id":"c","scope":"read","iss":"http://issuer","aud":"http://resource/","sub":"c","iat":100,"exp":160,"jti":"jti"}}"#
    );
    let response = fixture
        .call(
            "token_response",
            v(r#"{"plan":{"ttlSeconds":60,"scopes":[]},"token":"jwt"}"#),
        )
        .unwrap();
    assert_eq!(
        response,
        v(r#"{"access_token":"jwt","token_type":"Bearer","expires_in":60}"#)
    );
    let paths = fixture
        .call("endpoints", v(r#"{"pathname":"/oauth/"}"#))
        .unwrap();
    assert_eq!(
        paths.get("metadata"),
        Some(&v(r#""/.well-known/oauth-authorization-server/oauth""#))
    );
}
#[test]
fn direct_sdk_validation_priorities_do_not_move_url_or_ttl_behind_scope_errors() {
    let mut fixture = Fixture::new(v("{}")).unwrap();
    let payload = v(
        r#"{"payload":{"clientId":"c","resource":"bad","ttlSeconds":0,"scopes":["a b"]},"resource":{},"http":false}"#,
    );
    assert_eq!(
        fixture.call("direct", payload).unwrap_err().message,
        "resource must be an absolute URL"
    );
    let payload = v(
        r#"{"payload":{"clientId":"c","resource":"http://resource/","ttlSeconds":0,"scopes":["a b"]},"resource":{"href":"http://resource/","hash":""},"http":false}"#,
    );
    assert_eq!(
        fixture.call("direct", payload).unwrap_err().message,
        "ttlSeconds must be a positive integer"
    );
}
#[test]
fn request_redaction_removes_duplicate_secrets_without_reordering_other_params() {
    let mut fixture = Fixture::new(v("{}")).unwrap();
    assert_eq!(fixture.call("log_params",v(r#"{"params":[["code_verifier","one"],["x","a"],["code_verifier","two"],["refresh_token","secret"],["x","b"]]}"#)).unwrap(),v(r#"[["code_verifier","[redacted]"],["x","a"],["refresh_token","[redacted]"],["x","b"]]"#));
}
#[test]
fn cli_validates_decimal_values_static_clients_and_formats_suffix_help() {
    let mut fixture = Fixture::new(v("{}")).unwrap();
    assert!(
        fixture
            .call("cli_options", v(r#"{"values":{"port":"1e2"}}"#))
            .is_err()
    );
    let opts=fixture.call("cli_options",v(r#"{"values":{"port":"42","ttl-seconds":"120","static-client":["client:http://127.0.0.1/a, http://127.0.0.1/b"]}}"#)).unwrap();
    assert_eq!(opts.get("port"), Some(&Value::Number(42.0)));
    assert_eq!(opts.get("ttlSeconds"), Some(&Value::Number(120.0)));
    let help = fixture
        .call("cli_help", v(r#"{"name":"tiny-oauth-test-server-rust"}"#))
        .unwrap();
    assert!(json::stringify(&help).contains("Usage: tiny-oauth-test-server-rust"));
}
#[test]
fn listener_admission_resets_after_bind_fault_and_retains_active_state_after_close_fault() {
    let mut fixture = Fixture::new(v("{}")).unwrap();
    fixture.call("listen_start", v("{}")).unwrap();
    assert_eq!(
        fixture.call("listen_start", v("{}")).unwrap_err().message,
        "OAuth test server is already listening"
    );
    fixture.call("listen_fail", v("{}")).unwrap();
    fixture.call("listen_start", v("{}")).unwrap();
    fixture.call("listen_bound", v("{}")).unwrap();
    assert_eq!(
        fixture.call("close_needed", v("{}")).unwrap(),
        Value::Bool(true)
    );
    assert!(fixture.call("listen_start", v("{}")).is_err());
    fixture.call("closed", v("{}")).unwrap();
    assert_eq!(
        fixture.call("close_needed", v("{}")).unwrap(),
        Value::Bool(false)
    );
    fixture.call("listen_start", v("{}")).unwrap();
}
