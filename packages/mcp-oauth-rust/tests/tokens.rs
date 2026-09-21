use mcp_oauth_rust::tokens::{TokenFields, is_retryable, read_json_response};
use mcp_protocol_rust::json::{self, Limits, Value};
fn value(text: &str) -> Value {
    json::parse_utf16(&text.encode_utf16().collect::<Vec<_>>(), Limits::default()).unwrap()
}
#[test]
fn token_fields_trim_ecmascript_whitespace_and_preserve_undefined_clock_semantics() {
    let fields = TokenFields::parse(&value(r#"{"access_token":" \ufefftoken\ud800 ","token_type":"bEaReR","refresh_token":" refresh ","scope":" scope "}"#)).unwrap();
    assert!(!fields.needs_clock());
    let result = fields.complete(None).unwrap();
    assert_eq!(
        result.get("accessToken"),
        Some(&Value::String(
            "token".encode_utf16().chain([0xd800]).collect()
        ))
    );
    assert_eq!(result.get("expiresAt"), Some(&Value::Null));
    let fields = TokenFields::parse(&value(
        r#"{"access_token":"t","token_type":"Bearer","expires_in":2}"#,
    ))
    .unwrap();
    assert_eq!(
        fields.complete(Some(1000.0)).unwrap().get("expiresAt"),
        Some(&Value::Number(3000.0))
    );
    assert!(fields.complete(Some(-8_640_000_000_010_000.0)).is_err());
}
#[test]
fn invalid_fields_and_dates_reject_in_order() {
    for text in [
        r#"{}"#,
        r#"{"access_token":" ","token_type":"Bearer"}"#,
        r#"{"access_token":"t","token_type":"Bearer ","expires_in":0}"#,
        r#"{"access_token":"t","token_type":"Bearer","expires_in":-1}"#,
    ] {
        assert!(TokenFields::parse(&value(text)).is_err());
    }
    let fields = TokenFields::parse(&value(
        r#"{"access_token":"t","token_type":"Bearer","expires_in":0}"#,
    ))
    .unwrap();
    for clock in [
        None,
        Some(f64::NAN),
        Some(f64::INFINITY),
        Some(0.5),
        Some(8_640_000_000_000_001.0),
    ] {
        assert!(fields.complete(clock).is_err());
    }
    assert!(is_retryable(
        &"server_error".encode_utf16().collect::<Vec<_>>(),
        400.0
    ));
    assert!(!is_retryable(
        &"invalid_grant".encode_utf16().collect::<Vec<_>>(),
        400.0
    ));
}
#[test]
fn oauth_json_responses_require_objects_and_own_error_fields() {
    assert!(read_json_response(&"[]".encode_utf16().collect::<Vec<_>>(), true, 200.0).is_err());
    assert!(read_json_response(&"{}".encode_utf16().collect::<Vec<_>>(), true, 200.0).is_ok());
    assert!(
        read_json_response(&"not json".encode_utf16().collect::<Vec<_>>(), false, 503.0).is_err()
    );
}
#[test]
fn oauth_scope_sets_validate_ascii_sort_deduplicate_and_defer_until_after_expiry() {
    use mcp_oauth_rust::scope::normalize;
    assert_eq!(
        normalize(Some(&value(r#""write read write  READ""#))).unwrap(),
        Some("READ read write".encode_utf16().collect())
    );
    assert_eq!(normalize(Some(&value(r#""   ""#))).unwrap(), None);
    for invalid in [
        r#"null"#,
        r#"123"#,
        r#""read\twrite""#,
        r#""\ud800""#,
        r#""read\\write""#,
        r#""read\"write""#,
    ] {
        assert_eq!(
            normalize(Some(&value(invalid))),
            Err("Invalid OAuth scope syntax")
        );
    }
    let fields = TokenFields::parse(&value(
        r#"{"access_token":"t","token_type":"Bearer","expires_in":0,"scope":"\ud800"}"#,
    ))
    .unwrap();
    assert_eq!(
        fields.complete(Some(0.5)),
        Err("OAuth token response has invalid expires_in")
    );
    assert_eq!(
        fields.complete(Some(0.0)),
        Err("Invalid OAuth scope syntax")
    );
}
#[test]
fn token_auth_plans_encode_basic_credentials_and_never_duplicate_secrets() {
    use mcp_oauth_rust::token_auth::plan;
    let params = value(r#"{"grant_type":"refresh_token","resource":"https://resource.example/"}"#);
    let id = "client: a+🐈".encode_utf16().collect::<Vec<_>>();
    let secret = "secret: b+🐈".encode_utf16().collect::<Vec<_>>();
    let basic = plan(
        &params,
        &id,
        Some(&secret),
        Some(&value(r#""client_secret_basic""#)),
    )
    .unwrap();
    assert!(!basic.body.contains("client_id="));
    assert!(!basic.body.contains("client_secret="));
    assert_eq!(
        basic.authorization,
        Some(
            "Basic Y2xpZW50JTNBK2ElMkIlRjAlOUYlOTAlODg6c2VjcmV0JTNBK2IlMkIlRjAlOUYlOTAlODg=".into()
        )
    );
    let public = plan(&params, &id, Some(&secret), Some(&value(r#""none""#))).unwrap();
    assert!(public.body.contains("client_id="));
    assert!(!public.body.contains("client_secret="));
    assert_eq!(public.authorization, None);
    assert_eq!(
        plan(&params, &id, None, Some(&value(r#""client_secret_post""#))).unwrap_err(),
        "OAuth token endpoint authentication requires a client secret"
    );
    assert_eq!(
        plan(&params, &id, None, Some(&value(r#""private_key_jwt""#))).unwrap_err(),
        "Unsupported OAuth token endpoint authentication method"
    );
}
