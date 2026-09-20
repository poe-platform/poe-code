use mcp_oauth_rust::loopback::{
    CallbackBinding, CallbackParameters, build_success_page, normalize_input,
};
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn callback_binding_checks_state_before_authorization_denials_and_issuer_before_codes() {
    let expected = text("expected");
    let binding = CallbackBinding::new(Some(expected.clone()));
    let mut params = CallbackParameters {
        error: Some(text("access_denied")),
        ..Default::default()
    };
    assert_eq!(
        binding.resolve(&params).unwrap_err().message,
        text("OAuth callback missing state")
    );
    params.state = Some(text("wrong"));
    assert_eq!(
        binding.resolve(&params).unwrap_err().message,
        text("OAuth callback state mismatch")
    );
    params.state = Some(expected);
    let failure = binding.resolve(&params).unwrap_err();
    assert_eq!(
        failure.message,
        text("OAuth authorization failed: access_denied — access_denied")
    );
    assert_eq!(
        failure.response,
        text("Authorization failed: access_denied")
    );
    params.error = None;
    params.code = Some(vec![0xd800]);
    assert_eq!(binding.resolve(&params).unwrap(), vec![0xd800]);
}
#[test]
fn html_and_manual_input_preserve_utf16_and_escape_exactly_four_characters() {
    let page = build_success_page(Some(&text("<&\"'>")), Some(&[0xd800]));
    assert!(
        page.windows(text("&lt;&amp;&quot;'&gt;").len())
            .any(|part| part == text("&lt;&amp;&quot;'&gt;"))
    );
    assert!(page.contains(&0xd800));
    assert_eq!(
        normalize_input(&text("\r\n\u{feff} code \r\n")),
        text("code")
    );
    assert_eq!(normalize_input(&text("\u{0085}")), text("\u{0085}"));
}
#[test]
fn structured_state_enforces_optional_and_required_issuer_binding() {
    for required in [false, true] {
        let state =
            mcp_oauth_rust::state::create_authorization_state(&text("issuer"), required, &[7; 16])
                .unwrap();
        let binding = CallbackBinding::new(Some(text(&state)));
        let mut callback = CallbackParameters {
            state: Some(text(&state)),
            code: Some(text("code")),
            ..Default::default()
        };
        assert_eq!(binding.resolve(&callback).is_ok(), !required);
        callback.issuer = Some(text("wrong"));
        assert_eq!(
            binding.resolve(&callback).unwrap_err().message,
            text("OAuth callback issuer mismatch")
        );
        callback.issuer = Some(text("issuer"));
        assert_eq!(binding.resolve(&callback).unwrap(), text("code"));
    }
}
