use mcp_oauth_rust::registration::{assert_issuer, secret_expiry};
use mcp_protocol_rust::json::{self, Value};
fn value(text: &str) -> Value {
    json::parse_utf16(&text.encode_utf16().collect::<Vec<_>>(), Default::default()).unwrap()
}
#[test]
fn issuer_binding_is_exact_and_secret_expiry_skips_public_clients() {
    let client = value(
        r#"{"clientId":"c","clientSecret":"s","registration":{"issuer":"https://auth.example","client_secret_expires_at":10}}"#,
    );
    assert!(
        assert_issuer(
            &client,
            &"https://auth.example".encode_utf16().collect::<Vec<_>>()
        )
        .is_ok()
    );
    assert!(
        assert_issuer(
            &client,
            &"https://other.example".encode_utf16().collect::<Vec<_>>()
        )
        .is_err()
    );
    assert_eq!(secret_expiry(&client), Some(10.0));
    assert_eq!(
        secret_expiry(&value(
            r#"{"clientSecret":"s","tokenEndpointAuthMethod":"none","registration":{"client_secret_expires_at":10}}"#
        )),
        None
    );
    for expiry in ["null", "0"] {
        assert_eq!(
            secret_expiry(&value(&format!(
                r#"{{"clientSecret":"s","registration":{{"client_secret_expires_at":{expiry}}}}}"#
            ))),
            None
        );
    }
}
#[test]
fn ownership_survives_normalization_and_caller_cache_precedes_native_replacement() {
    use mcp_oauth_rust::registration::{caller_owned, imported_client, normalize_stored};
    let client = value(
        r#"{"clientId":"c","registration":{"client_id":"c"},"registrationOwnership":"caller"}"#,
    );
    assert!(caller_owned(&normalize_stored(&client).unwrap().unwrap()));
    assert_eq!(imported_client(Some(&client), None), 1);
    assert_eq!(imported_client(None, Some(&client)), 2);
    assert!(
        normalize_stored(&value(
            r#"{"clientId":"c","registrationOwnership":"caller"}"#
        ))
        .is_err()
    );
    assert!(
        normalize_stored(&value(
            r#"{"clientId":"c","registration":{"client_id":"c"},"registrationOwnership":false}"#
        ))
        .is_err()
    );
}
