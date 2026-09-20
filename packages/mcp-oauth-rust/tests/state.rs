use mcp_oauth_rust::state::{create_authorization_state, parse_authorization_state};
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn authorization_state_round_trips_and_validates_entropy() {
    let issuer = units("https://auth.example/🦊");
    let state = create_authorization_state(&issuer, true, &[7; 16]).unwrap();
    let parsed = parse_authorization_state(Some(&units(&state))).unwrap();
    assert_eq!(parsed.issuer, issuer);
    assert!(parsed.require_issuer);
    assert!(create_authorization_state(&units("issuer"), false, &[0; 15]).is_err());
    assert!(parse_authorization_state(None).is_none());
    assert!(parse_authorization_state(Some(&[])).is_none());
}
#[test]
fn parsed_fields_are_own_typed_and_nonempty() {
    use mcp_oauth_rust::base64::encode_url;
    for source in [
        "{}",
        "[]",
        "null",
        r#"{"v":2,"n":"n","i":"issuer","r":true}"#,
        r#"{"v":1,"n":"","i":"issuer","r":true}"#,
        r#"{"v":1,"n":"n","i":"","r":true}"#,
        r#"{"v":1,"n":"n","i":"issuer","r":1}"#,
    ] {
        assert!(
            parse_authorization_state(Some(&units(&encode_url(source.as_bytes())))).is_none(),
            "{source}"
        );
    }
}
