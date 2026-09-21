use mcp_oauth_rust::grant::TokenGrant;
use mcp_protocol_rust::json::{self, Value};
fn input(extra: &str) -> Value {
    json::parse(
        format!(r#"{{"access_token":" a ","refresh_token":" r ","token_type":"bEaReR"{extra}}}"#)
            .as_bytes(),
        Default::default(),
    )
    .unwrap()
}
#[test]
fn raw_grants_validate_all_timings_and_anchor_relative_lifetimes() {
    let grant = TokenGrant::parse(&input(
        r#", "expires_in":2,"expires_at":5,"expiresAt":3,"scope":"write read read""#,
    ))
    .unwrap();
    assert_eq!(grant.access(), &[97]);
    let timing = grant.timing().unwrap();
    assert_eq!(timing.lifetime, Some(2.0));
    assert_eq!(grant.absolute_expiry().unwrap(), Some(3.0));
    assert!(grant.validate_relative(Some(10_000.0)).is_ok());
    assert!(grant.validate_relative(Some(f64::NAN)).is_err());
    assert_eq!(
        grant.fields().unwrap().get("scope"),
        Some(&Value::String("read write".encode_utf16().collect()))
    );
    for extra in [
        r#", "expires_in":-1"#,
        r#", "expires_in":0.5"#,
        r#", "expires_at":9007199254740991"#,
        r#", "expiresAt":8640000000000001"#,
    ] {
        let grant = TokenGrant::parse(&input(extra)).unwrap();
        assert!(
            grant
                .timing()
                .and_then(|_| grant.absolute_expiry())
                .is_err()
        );
    }
}
#[test]
fn grant_admission_rejects_invalid_secrets_scope_and_oversized_extensions() {
    for text in [
        r#"{"access_token":"a","token_type":"Basic"}"#,
        r#"{"access_token":"a","token_type":"Bearer","refresh_token":false}"#,
    ] {
        let payload = json::parse(text.as_bytes(), Default::default()).unwrap();
        assert!(TokenGrant::parse(&payload).is_err());
    }
    let grant = TokenGrant::parse(&input(r#", "scope":"""#)).unwrap();
    assert!(grant.fields().is_err());
    assert!(
        TokenGrant::parse(&input(&format!(
            r#", "extension":"{}""#,
            "x".repeat(65_536)
        )))
        .is_err()
    );
}
#[test]
fn batched_import_validates_all_timing_before_completing_owned_fields() {
    let grant = TokenGrant::parse(&input(
        r#", "expires_in":2,"expires_at":5,"scope":"write read read""#,
    ))
    .unwrap();
    let timing = grant
        .prepare_import(Some(&Value::Number(9000.0)), Some(&Value::Number(1000.0)))
        .unwrap();
    assert_eq!(timing.lifetime, Some(2.0));
    let output = grant.complete_import(&timing, Some(1000.0)).unwrap();
    assert_eq!(output.get("expiresAt"), Some(&Value::Number(9000.0)));
    assert_eq!(
        output.get("scope"),
        Some(&Value::String("read write".encode_utf16().collect()))
    );
    assert!(
        grant
            .complete_import(&timing, Some(-8_640_000_000_001_000.0))
            .is_err()
    );
    assert!(
        grant
            .prepare_import(Some(&Value::Bool(true)), None)
            .is_err()
    );
    assert!(grant.prepare_import(None, Some(&Value::Null)).is_err());
    let invalid = TokenGrant::parse(&input(r#", "expires_at":8640000000001"#)).unwrap();
    assert!(
        invalid
            .prepare_import(Some(&Value::Number(9000.0)), None)
            .is_err()
    );
}
