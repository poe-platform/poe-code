use mcp_oauth_rust::scope::{assert_authorization, assert_profile};
use mcp_protocol_rust::json::Value;
fn value(text: &str) -> Value {
    Value::String(text.encode_utf16().collect())
}
#[test]
fn profiles_compare_exact_normalized_sets_and_missing_exchange_scope_is_allowed() {
    assert!(
        assert_profile(
            Some(&value("read write")),
            Some(&value(" write  read ")),
            false
        )
        .is_ok()
    );
    assert!(assert_profile(Some(&value("read write")), Some(&value("read")), false).is_err());
    assert!(assert_profile(None, Some(&value("read")), false).is_err());
    assert!(assert_profile(Some(&value("READ")), Some(&value("read")), true).is_err());
    assert!(assert_profile(Some(&value("read\\write")), Some(&value("read")), true).is_err());
    assert!(assert_authorization(None, Some(&value("read"))).is_ok());
    assert!(assert_authorization(Some(&value("read write")), Some(&value("read"))).is_err());
}
