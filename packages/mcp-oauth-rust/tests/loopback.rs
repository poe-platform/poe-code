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
        text("OAuth authorization failed: access_denied — access_denied")
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

#[test]
fn loopback_lifecycle_admits_one_wait_and_idempotent_teardown() {
    use mcp_oauth_rust::loopback::{Lifecycle, valid_timer};
    let mut state = Lifecycle::default();
    assert!(state.begin());
    assert!(!state.begin());
    assert!(state.close());
    assert!(!state.close());
    assert!(!state.begin());
    for timer in [1.0, 120_000.0, 2_147_483_647.0] {
        assert!(valid_timer(timer));
    }
    for timer in [0.0, -1.0, 1.5, f64::NAN, f64::INFINITY, 2_147_483_648.0] {
        assert!(!valid_timer(timer));
    }
}

#[test]
fn fixed_redirects_accept_only_exact_loopback_host_and_reject_parameter_spoofing() {
    use mcp_oauth_rust::loopback::valid_target;
    use mcp_protocol_rust::json::parse;
    let safe = r#"{"protocol":"http:","hostname":"localhost","port":"39119","pathMatches":true}"#;
    let value = parse(safe.as_bytes(), Default::default()).unwrap();
    assert!(valid_target(&value, true));
    for invalid in [
        safe.replace("localhost", "127.0.0.2"),
        safe.replace("39119", "0"),
        safe.replace("true", "false"),
        safe.replace("http:", "https:"),
        safe.replace("pathMatches", "forbiddenQuery"),
    ] {
        assert!(!valid_target(
            &parse(invalid.as_bytes(), Default::default()).unwrap(),
            true
        ));
    }
    for field in ["credentials", "fragment", "forbiddenQuery", "controls"] {
        let value = format!("{{\"{field}\":true,{}", &safe[1..]);
        assert!(!valid_target(
            &parse(value.as_bytes(), Default::default()).unwrap(),
            true
        ));
    }
}

#[test]
fn callback_parameter_multiplicity_uses_recognized_field_priority() {
    use mcp_oauth_rust::loopback::{CALLBACK_PARAMETERS, duplicate_parameter};
    for index in 0..CALLBACK_PARAMETERS.len() {
        let mut counts = vec![1; CALLBACK_PARAMETERS.len()];
        counts[index] = 2;
        assert_eq!(
            duplicate_parameter(&counts),
            Some(CALLBACK_PARAMETERS[index])
        );
    }
    assert_eq!(duplicate_parameter(&[1; 6]), None);
    assert_eq!(duplicate_parameter(&[3; 6]), Some("code"));
    let failure = CallbackBinding::new(None)
        .resolve(&CallbackParameters {
            error: Some(text("access_denied")),
            error_description: Some(text("Denied")),
            ..Default::default()
        })
        .unwrap_err();
    assert_eq!(
        failure.denial,
        Some((text("access_denied"), text("Denied")))
    );
}
