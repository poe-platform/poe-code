use mcp_oauth_server_rust::security::{cookie_value, security_cookie};
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn security_cookie_enforces_host_prefix_and_positive_integer_lifetime() {
    assert_eq!(
        security_cookie(&text("__Host-csrf"), 600.0, &text("secret")).unwrap(),
        text("__Host-csrf=secret; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax")
    );
    for name in ["csrf", "__Host-csrf;other", "__Host-csrf=other"] {
        assert!(security_cookie(&text(name), 600.0, &text("x")).is_err());
    }
    for seconds in [0.0, -1.0, 0.5, f64::INFINITY, f64::NAN] {
        assert!(security_cookie(&text("__Host-csrf"), seconds, &text("x")).is_err());
    }
}
#[test]
fn cookie_matching_is_exact_and_uses_first_matching_entry() {
    assert_eq!(
        cookie_value(
            Some(&text(
                "other=x; \u{feff}__Host-csrf=secret ; __Host-csrf=second"
            )),
            &text("__Host-csrf")
        ),
        Some(text("secret"))
    );
    assert_eq!(
        cookie_value(Some(&text("prefix__Host-csrf=x")), &text("__Host-csrf")),
        None
    );
    assert_eq!(cookie_value(None, &text("__Host-csrf")), None);
}
