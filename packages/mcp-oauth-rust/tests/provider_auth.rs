use mcp_oauth_rust::token_auth::{
    Method, assert_session_method, assert_supported, choose_registration_method,
};
use mcp_protocol_rust::json::{self, Value};
fn value(source: &str) -> Value {
    json::parse_utf16(
        &source.encode_utf16().collect::<Vec<_>>(),
        Default::default(),
    )
    .unwrap()
}
#[test]
fn supported_methods_are_bounded_and_selection_prefers_public_then_basic() {
    let metadata = value(
        r#"{"token_endpoint_auth_methods_supported":["client_secret_post","client_secret_basic"]}"#,
    );
    assert_eq!(
        choose_registration_method(&metadata, None),
        Ok(Method::Basic)
    );
    assert!(choose_registration_method(&metadata, Some(&value(r#""none""#))).is_err());
    assert_eq!(
        choose_registration_method(&value("{}"), None),
        Ok(Method::None)
    );
    assert!(
        choose_registration_method(
            &value(r#"{"token_endpoint_auth_methods_supported":false}"#),
            None
        )
        .is_err()
    );
    assert!(assert_supported(&value(r#"{"clientId":"c"}"#), &metadata).is_err());
    assert!(
        assert_supported(
            &value(r#"{"clientId":"c","tokenEndpointAuthMethod":"client_secret_basic"}"#),
            &metadata
        )
        .is_err()
    );
    assert!(assert_supported(&value(r#"{"clientId":"c","clientSecret":"s","tokenEndpointAuthMethod":"client_secret_basic"}"#),&metadata).is_ok());
    assert!(
        assert_session_method(
            &value(r#"{"clientId":"c","clientSecret":"s"}"#),
            Some(Method::Basic)
        )
        .is_err()
    );
    assert!(
        assert_session_method(
            &value(r#"{"clientId":"c","clientSecret":"s"}"#),
            Some(Method::Post)
        )
        .is_ok()
    );
}
