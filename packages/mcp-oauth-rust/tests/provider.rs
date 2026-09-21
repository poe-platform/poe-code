use mcp_oauth_rust::provider::{
    Effect, Endpoint, RetryState, SessionFlow, normalize_client, normalize_tokens,
};
use mcp_protocol_rust::json::{self, Limits, Value};
fn value(text: &str) -> Value {
    json::parse_utf16(&text.encode_utf16().collect::<Vec<_>>(), Limits::default()).unwrap()
}
#[test]
fn session_flow_requests_fresh_clocks_at_each_original_expiry_check() {
    let tokens =
        value(r#"{"accessToken":"t","tokenType":"Bearer","expiresAt":0,"refreshToken":"r"}"#);
    let mut flow = SessionFlow::new(Some(tokens), true, false, false);
    assert_eq!(flow.next(None), Effect::Clock);
    assert_eq!(flow.next(Some(1000.0)), Effect::Continue);
    assert_eq!(flow.next(None), Effect::Clock);
    assert_eq!(flow.next(Some(1000.0)), Effect::Refresh);
    flow.refreshed(Some(value(
        r#"{"accessToken":"new","tokenType":"Bearer","expiresAt":3000}"#,
    )));
    assert_eq!(flow.next(None), Effect::Clock);
    assert_eq!(flow.next(Some(1000.0)), Effect::Use);
}
#[test]
fn normalization_rejects_invalid_refresh_and_invalid_optional_scope() {
    assert!(normalize_client(&value(r#"{"clientId":" c ","clientSecret":null}"#), false).is_none());
    assert!(normalize_client(&value(r#"{"clientId":" c ","clientSecret":" "}"#), true).is_some());
    assert!(
        normalize_tokens(&value(
            r#"{"accessToken":" t ","tokenType":"Bearer","expiresAt":null,"scope":12}"#
        ))
        .is_none()
    );
    assert!(
        normalize_tokens(&value(
            r#"{"accessToken":"t","tokenType":"Bearer","expiresAt":null,"refreshToken":" "}"#
        ))
        .is_none()
    );
}
#[test]
fn endpoint_and_retry_policy_accept_real_loopback_and_limit_distinct_retries() {
    assert!(
        Endpoint {
            protocol: "http:",
            hostname: "127.0.0.2",
            credentials: false,
            fragment: false,
            access_token: false
        }
        .validate("Token endpoint", true)
        .is_ok()
    );
    assert!(
        Endpoint {
            protocol: "http:",
            hostname: "127.attacker.example",
            credentials: false,
            fragment: false,
            access_token: false
        }
        .validate("Token endpoint", true)
        .is_err()
    );
    let mut retries = RetryState::default();
    assert_eq!(
        retries.authorization(true, "server_error", 400.0, false),
        "retry"
    );
    assert_eq!(
        retries.authorization(true, "invalid_client", 400.0, true),
        "reregister"
    );
    assert_eq!(
        retries.authorization(true, "server_error", 503.0, true),
        "throw"
    );
    assert_eq!(
        retries.authorization(true, "invalid_client", 400.0, true),
        "throw"
    );
}
#[test]
fn forced_authorization_clears_stale_tokens_without_calling_clock() {
    let tokens = value(r#"{"accessToken":"t","tokenType":"Bearer","expiresAt":0}"#);
    let mut flow = SessionFlow::new(Some(tokens), true, true, true);
    assert_eq!(flow.next(None), Effect::Continue);
    assert_eq!(flow.next(None), Effect::Continue);
    assert_eq!(flow.next(None), Effect::ClearTokens);
    assert_eq!(flow.next(None), Effect::Authorize);
}
#[test]
fn refresh_error_lookup_does_not_consume_retry_and_invalid_grants_skip_lookup() {
    let mut retries = RetryState::default();
    assert_eq!(retries.refresh(true, "server_error", 503.0, None), "load");
    assert_eq!(
        retries.refresh(true, "server_error", 503.0, Some(false)),
        "retry"
    );
    assert_eq!(
        retries.refresh(true, "server_error", 503.0, Some(false)),
        "throw"
    );
    assert_eq!(retries.refresh(true, "invalid_grant", 503.0, None), "clear");
    assert_eq!(
        retries.refresh(true, "invalid_client", 400.0, Some(true)),
        "reregister"
    );
}

#[test]
fn cached_tokens_require_the_configured_static_client_identity() {
    use mcp_oauth_rust::provider::binding_action;
    let resource: Vec<u16> = "r".encode_utf16().collect();
    let session = value(
        r#"{"resource":"r","authorizationServer":"a","discovery":{"authorizationServerMetadata":{"issuer":"a"}},"client":{"clientId":"c","clientSecret":"s"},"tokens":{}}"#,
    );
    let matching = value(r#"{"mode":"static","clientId":" c ","clientSecret":" s "}"#);
    assert_eq!(
        binding_action(&resource, Some(&session), None, Some(&matching)),
        Ok("keep")
    );
    let mismatch = value(r#"{"mode":"static","clientId":"different"}"#);
    assert!(
        binding_action(&resource, Some(&session), None, Some(&mismatch))
            .unwrap_err()
            .contains("different OAuth client")
    );
}

#[test]
fn dynamic_registration_metadata_survives_client_normalization() {
    use mcp_oauth_rust::provider::registered_client;
    let payload =
        value(r#"{"client_id":"dynamic","token_endpoint_auth_method":"none","extra":true}"#);
    let registered = registered_client(&payload).unwrap();
    assert_eq!(registered.get("registration"), Some(&payload));
    let normalized = normalize_client(&registered, false).unwrap();
    assert_eq!(normalized.get("registration"), Some(&payload));
}

#[test]
fn full_registration_preserves_json_extensions_and_enforces_nullable_metadata() {
    use mcp_oauth_rust::registration::validate;
    let valid = value(
        r#"{"client_id":" registered ","client_secret":"s","redirect_uris":["http://localhost/cb"],"contacts":null,"client_id_issued_at":0,"jwks":{"keys":[]},"provider_metadata":{"enabled":true},"token_endpoint_auth_method":"private_key_jwt"}"#,
    );
    assert!(validate(&valid).is_ok());
    for invalid in [
        r#"{"client_id":""}"#,
        r#"{"client_id":"c","redirect_uris":"bad"}"#,
        r#"{"client_id":"c","contacts":[false]}"#,
        r#"{"client_id":"c","client_secret_expires_at":-1}"#,
        r#"{"client_id":"c","scope":"read\twrite"}"#,
    ] {
        assert!(validate(&value(invalid)).is_err());
    }
    assert_eq!(
        validate(&value("{}")),
        Err("OAuth client registration response missing client_id")
    );
    let mut huge = valid.clone();
    if let Value::Object(fields) = &mut huge {
        fields.push((
            "large".encode_utf16().collect(),
            Value::String("😀".repeat(16384).encode_utf16().collect()),
        ));
    }
    assert_eq!(
        validate(&huge),
        Err("Invalid OAuth client registration metadata")
    );
}

#[test]
fn stored_registration_requires_matching_identity_and_authentication() {
    use mcp_oauth_rust::registration::normalize_stored;
    let input = value(
        r#"{"clientId":" c ","clientSecret":" s ","registration":{"client_id":" c ","client_secret":" s ","token_endpoint_auth_method":"client_secret_basic","extra":true}}"#,
    );
    let normalized = normalize_stored(&input).unwrap().unwrap();
    assert_eq!(normalized.get("registration"), input.get("registration"));
    assert_eq!(normalized.get("clientId"), Some(&value(r#""c""#)));
    assert_eq!(
        normalized.get("tokenEndpointAuthMethod"),
        Some(&value(r#""client_secret_basic""#))
    );
    assert_eq!(
        normalize_stored(&value(
            r#"{"clientId":"c","registration":{"client_id":"different"}}"#
        )),
        Err("OAuth client registration does not match the client identity")
    );
    assert_eq!(
        normalize_stored(&value(
            r#"{"clientId":"c","tokenEndpointAuthMethod":"none","registration":{"client_id":"c","token_endpoint_auth_method":"client_secret_basic"}}"#
        )),
        Err("OAuth token endpoint authentication conflicts with the client registration")
    );
    assert_eq!(
        normalize_stored(&value(r#"{"clientId":"c","clientSecret":null}"#)),
        Ok(None)
    );
}

#[test]
fn rejected_grants_match_rotated_refresh_tokens_and_full_provenance() {
    use mcp_oauth_rust::provider::same_token_grant;
    let current = value(
        r#"{"accessToken":"a","refreshToken":"r","tokenType":"Bearer","expiresAt":100,"scope":"read"}"#,
    );
    assert!(same_token_grant(&current, &current));
    for rejected in [
        r#"{"accessToken":"a","refreshToken":"old","tokenType":"Bearer","expiresAt":100,"scope":"read"}"#,
        r#"{"accessToken":"a","refreshToken":"r","tokenType":"Bearer","expiresAt":100,"scope":"write"}"#,
    ] {
        assert!(!same_token_grant(&current, &value(rejected)));
    }
}

#[test]
fn stored_clients_retain_explicit_registration_redirect_identity() {
    let input =
        value(r#"{"clientId":"c","requestedRedirectUri":"http://localhost:39119/cb?app=one"}"#);
    let normalized = mcp_oauth_rust::registration::normalize_stored(&input)
        .unwrap()
        .unwrap();
    assert_eq!(
        normalized.get("requestedRedirectUri"),
        input.get("requestedRedirectUri")
    );
}

#[test]
fn fresh_redirect_port_aliases_never_change_scheme_host_path_or_query() {
    use mcp_oauth_rust::registration::redirect_pair_allowed as allowed;
    assert!(allowed(true, true, "127.0.0.1", "localhost", true, true));
    assert!(allowed(true, true, "[::1]", "[::1]", true, true));
    assert!(!allowed(true, true, "127.0.0.1", "localhost", false, true));
    assert!(!allowed(false, true, "localhost", "localhost", true, true));
    assert!(!allowed(
        true,
        true,
        "attacker.example",
        "attacker.example",
        true,
        true
    ));
    assert!(!allowed(true, true, "localhost", "localhost", true, false));
}

#[test]
fn imported_grant_expiry_is_anchored_once_and_absolute_expiry_wins() {
    use mcp_oauth_rust::provider::normalize_imported_tokens;
    let relative = value(r#"{"accessToken":"t","tokenType":"Bearer","expiresIn":3600}"#);
    let normalized = normalize_imported_tokens(&relative, 1000.0)
        .unwrap()
        .unwrap();
    assert_eq!(
        normalized.get("expiresAt"),
        Some(&Value::Number(3_601_000.0))
    );
    let absolute =
        value(r#"{"accessToken":"t","tokenType":"Bearer","expiresIn":3600,"expiresAt":0}"#);
    assert_eq!(
        normalize_imported_tokens(&absolute, 1000.0)
            .unwrap()
            .unwrap()
            .get("expiresAt"),
        Some(&Value::Number(0.0))
    );
    for invalid in [
        r#"{"expiresIn":-1}"#,
        r#"{"expiresIn":1.5}"#,
        r#"{"issuedAt":null}"#,
    ] {
        assert!(normalize_imported_tokens(&value(invalid), 1000.0).is_err());
    }
}

#[test]
fn configured_dynamic_apps_check_cached_and_pending_grants_before_any_recovery() {
    use mcp_oauth_rust::provider::binding_action;
    let resource: Vec<u16> = "r".encode_utf16().collect();
    for state in [r#""tokens":{}"#, r#""refreshState":"pending""#] {
        let session = value(&format!(
            r#"{{"resource":"r","authorizationServer":"a","discovery":{{"authorizationServerMetadata":{{"issuer":"a"}}}},"client":{{"clientId":"c","clientSecret":"private"}},{state}}}"#
        ));
        for configured in [
            r#"{"mode":"dynamic","clientId":"other"}"#,
            r#"{"mode":"dynamic","clientId":"c"}"#,
            r#"{"mode":"dynamic","clientId":"c","clientSecret":"different-private"}"#,
        ] {
            let failure = binding_action(&resource, Some(&session), None, Some(&value(configured)))
                .unwrap_err();
            assert!(failure.contains("different OAuth client"));
            assert!(!failure.contains("private"));
        }
        assert_eq!(
            binding_action(
                &resource,
                Some(&session),
                None,
                Some(&value(r#"{"mode":"dynamic"}"#))
            ),
            Ok("keep")
        );
        assert_eq!(
            binding_action(
                &resource,
                Some(&session),
                None,
                Some(&value(
                    r#"{"mode":"dynamic","clientId":" c ","clientSecret":" private "}"#
                ))
            ),
            Ok("keep")
        );
    }
}

#[test]
fn imported_clock_is_only_needed_for_unanchored_relative_expiry() {
    use mcp_oauth_rust::provider::imported_clock_required;
    for input in [
        r#"{}"#,
        r#"{"expiresAt":1000,"expiresIn":2}"#,
        r#"{"expiresIn":2,"issuedAt":1000}"#,
    ] {
        assert_eq!(imported_clock_required(&value(input)), Ok(false));
    }
    assert_eq!(
        imported_clock_required(&value(r#"{"expiresIn":2}"#)),
        Ok(true)
    );
    assert_eq!(
        imported_clock_required(&value(r#"{"expiresAt":null,"expiresIn":2}"#)),
        Ok(true)
    );
    assert!(imported_clock_required(&value(r#"{"expiresAt":1000,"expiresIn":-1}"#)).is_err());
    assert!(imported_clock_required(&value(r#"{"expiresAt":1000,"issuedAt":null}"#)).is_err());
}

#[test]
fn issuer_url_policy_rejects_queries_after_secure_admission() {
    let issuer = Endpoint {
        protocol: "https:",
        hostname: "issuer.example",
        credentials: false,
        fragment: false,
        access_token: false,
    };
    assert_eq!(issuer.validate_issuer(false), Ok(()));
    assert_eq!(
        issuer.validate_issuer(true),
        Err("Authorization server issuer must not include query or fragment".into())
    );
    let insecure = Endpoint {
        protocol: "http:",
        hostname: "issuer.example",
        credentials: false,
        fragment: false,
        access_token: false,
    };
    assert_eq!(
        insecure.validate_issuer(true),
        Err("Authorization server issuer must use https unless it targets a loopback host".into())
    );
}
