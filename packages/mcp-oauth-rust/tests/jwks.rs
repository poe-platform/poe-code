use mcp_oauth_rust::jwks::{
    Cache, Configuration, Token, candidates, claims, import_plan, parse_jwks,
};
use mcp_protocol_rust::json::{self, Limits, Value};
fn v(text: &str) -> Value {
    json::parse_utf16(&text.encode_utf16().collect::<Vec<_>>(), Limits::default()).unwrap()
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
fn endpoint_and_numeric_configuration_have_exact_validation_order() {
    let c = Configuration {
        skew: 30.0,
        ttl: 300000.0,
        timeout: 5000.0,
        cooldown: 30000.0,
    };
    assert!(c.validate("https:", "auth.example", false, false).is_ok());
    assert!(c.validate("http:", "dev.localhost", false, false).is_ok());
    assert!(c.validate("http:", "127.1.2.255", false, false).is_ok());
    assert_eq!(
        c.validate("http:", "127.attacker.example", false, false),
        Err("jwksUrl must use HTTPS for non-loopback hosts")
    );
    assert_eq!(
        c.validate("ftp:", "localhost", false, true),
        Err("jwksUrl must be an HTTP or HTTPS URL without credentials")
    );
    let invalid = Configuration {
        skew: f64::NAN,
        ..c
    };
    assert_eq!(
        invalid.validate("http:", "remote", false, false),
        Err("clockSkewSeconds must be a finite non-negative number")
    );
}
#[test]
fn compact_header_policy_runs_before_key_loading() {
    assert_eq!(
        Token::new(
            &token(r#"{"alg":"ES256","crit":["future"]}"#, "{}"),
            &["ES256".into()]
        )
        .unwrap_err(),
        "unsupported critical token claims"
    );
    for alg in ["none", "HS256", "RS256"] {
        assert_eq!(
            Token::new(
                &token(&format!(r#"{{"alg":"{alg}"}}"#), "{}"),
                &["ES256".into()]
            )
            .unwrap_err(),
            "unsupported token algorithm"
        );
    }
    assert!(
        Token::new(
            &"invalid".encode_utf16().collect::<Vec<_>>(),
            &["ES256".into()]
        )
        .is_err()
    );
}
#[test]
fn candidate_selection_preserves_order_and_ignores_wrong_typed_optional_filters() {
    let keys = parse_jwks(r#"{"keys":[{"kid":"a"},{"kid":"a","use":"enc"},{"kid":"a","alg":3,"use":false},{"kid":"a","key_ops":[]},{"kid":"b"}]}"#).unwrap();
    let jwt = Token::new(
        &token(r#"{"alg":"ES256","kid":"a"}"#, "{}"),
        &["ES256".into()],
    )
    .unwrap();
    assert_eq!(candidates(&keys, &jwt).len(), 2);
    assert!(parse_jwks(r#"{"keys":[null]}"#).is_err());
    assert!(parse_jwks(r#"{}"#).is_err());
}
#[test]
fn import_policy_builds_crypto_parameters_and_rejects_malformed_material() {
    let key = v(r#"{"kty":"RSA","n":"n","e":"AQAB"}"#);
    let plan = import_plan(&key, "PS384").unwrap();
    assert_eq!(
        plan.get("verify").unwrap().get("saltLength"),
        Some(&Value::Number(48.0))
    );
    assert_eq!(
        plan.get("import").unwrap().get("name"),
        Some(&v(r#""RSA-PSS""#))
    );
    assert!(import_plan(&v(r#"{"kty":"EC"}"#), "RS256").is_err());
    assert!(import_plan(&v(r#"{"kty":"RSA","oth":[]}"#), "RS256").is_err());
}
#[test]
fn claim_validation_order_matches_jose_and_skew_uses_seconds() {
    let header = v(r#"{"typ":"JWT"}"#);
    let issuers = vec!["issuer".encode_utf16().collect()];
    let payload = v(r#"{"iss":"other","exp":0,"nbf":200}"#);
    assert_eq!(
        claims(&header, &payload, &issuers, 100.0, 30.0, true),
        Err("invalid access token type")
    );
    assert_eq!(
        claims(&header, &payload, &issuers, 100.0, 30.0, false),
        Err("issuer mismatch")
    );
    assert_eq!(
        claims(
            &header,
            &v(r#"{"iss":"issuer"}"#),
            &issuers,
            100.0,
            30.0,
            false
        ),
        Err("token missing expiry")
    );
    assert_eq!(
        claims(
            &header,
            &v(r#"{"iss":"issuer","exp":0,"nbf":200}"#),
            &issuers,
            100.0,
            30.0,
            false
        ),
        Err("token not active yet")
    );
    assert!(
        claims(
            &header,
            &v(r#"{"iss":"issuer","exp":71}"#),
            &issuers,
            100.0,
            30.0,
            false
        )
        .is_ok()
    );
    assert_eq!(
        claims(
            &header,
            &v(r#"{"iss":"issuer","exp":70}"#),
            &issuers,
            100.0,
            30.0,
            false
        ),
        Err("token expired")
    );
}
#[test]
fn token_scopes_use_literal_space_and_own_scope_precedence() {
    let jwt = Token::new(&token(r#"{"alg":"ES256"}"#, r#"{"iss":"issuer","exp":200,"scope":" a  \t b\tc \uFEFF ","scopes":["ignored"],"aud":["resource"],"sub":"subject","client_id":12}"#), &["ES256".into()]).unwrap();
    let payload = jwt.payload().unwrap();
    let result = jwt
        .result(
            &payload,
            &"resource".encode_utf16().collect::<Vec<_>>(),
            &[],
        )
        .unwrap();
    assert_eq!(result.get("scopes"), Some(&v(r#"["a","b\tc"]"#)));
    assert!(result.get("clientId").is_none());
    assert_eq!(
        jwt.result(&payload, &[], &["missing".encode_utf16().collect()]),
        Err("insufficient scope")
    );
}
#[test]
fn cache_expiration_and_failed_forced_refresh_cooldown_are_native_policy() {
    let mut cache = Cache::new(50.0, 30.0);
    cache.store(vec![v("{}")], 100.0);
    assert!(cache.cached(149.0).is_some());
    assert!(cache.cached(150.0).is_none());
    assert!(cache.force(100.0));
    assert!(!cache.force(129.0));
    assert!(cache.force(130.0));
}
#[test]
fn cached_documents_remain_immutable_while_another_request_refreshes() {
    let mut cache = Cache::new(50.0, 30.0);
    cache.store(vec![v(r#"{"kid":"old"}"#)], 100.0);
    let old = cache.snapshot().unwrap();
    cache.store(vec![v(r#"{"kid":"new"}"#)], 110.0);
    assert_eq!(old[0].get("kid"), Some(&v(r#""old""#)));
    assert_eq!(cache.keys()[0].get("kid"), Some(&v(r#""new""#)));
}
#[test]
fn native_cache_releases_replaced_documents_after_requests_drop_their_snapshots() {
    let mut cache = Cache::new(50.0, 30.0);
    let mut previous = Vec::new();
    for i in 0..4096 {
        cache.store(vec![Value::Number(i as f64)], i as f64);
        let snapshot = cache.snapshot().unwrap();
        previous.push(std::sync::Arc::downgrade(&snapshot));
    }
    assert!(previous[..4095].iter().all(|weak| weak.upgrade().is_none()));
    assert_eq!(std::sync::Arc::strong_count(&cache.snapshot().unwrap()), 2);
    drop(cache);
    assert!(previous.iter().all(|weak| weak.upgrade().is_none()));
}
