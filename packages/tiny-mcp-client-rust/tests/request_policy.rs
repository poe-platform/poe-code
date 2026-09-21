use tiny_mcp_client_rust::request_policy::{valid_protocol_pin, valid_timeout};

#[test]
fn timers_fit_the_host_without_overflow_or_nonfinite_values() {
    for value in [0.0, 0.5, 2_147_483_647.0] {
        assert!(valid_timeout(value));
    }
    for value in [-1.0, f64::NAN, f64::INFINITY, 2_147_483_648.0] {
        assert!(!valid_timeout(value));
    }
}

#[test]
fn pins_select_only_supported_versions() {
    assert!(valid_protocol_pin("2025-03-26"));
    assert!(valid_protocol_pin("2025-06-18"));
    assert!(valid_protocol_pin("2025-11-25"));
    assert!(valid_protocol_pin("2026-07-28"));
    for pin in ["auto", "", "2099-01-01"] {
        assert!(!valid_protocol_pin(pin));
    }
}
