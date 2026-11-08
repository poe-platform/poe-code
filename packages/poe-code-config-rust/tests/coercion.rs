use poe_code_config_rust::coerce;
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn ecmascript_numbers_and_boolean_admission() {
    for (s, n) in [
        ("  .5\u{feff}", 0.5),
        ("1.", 1.0),
        ("+2e2", 200.0),
        ("0x10", 16.0),
        ("0b101", 5.0),
        ("0o10", 8.0),
        ("-0", -0.0),
    ] {
        assert_eq!(coerce::number_text(&u(s)), Some(n), "{s}");
    }
    for s in [
        "", " ", "Infinity", "NaN", "inf", "1_000", "-0x1", "0b2", "1e", "1 2",
    ] {
        assert_eq!(coerce::number_text(&u(s)), None, "{s}");
    }
    assert_eq!(
        coerce::number_text(&u("0xffffffffffffffff")),
        Some(18446744073709551616.0)
    );
    for (s, v) in [("true", true), ("1", true), ("false", false), ("0", false)] {
        assert_eq!(coerce::boolean_text(&u(s)), Some(v));
    }
    for s in ["TRUE", " true ", "yes", ""] {
        assert_eq!(coerce::boolean_text(&u(s)), None);
    }
}
#[test]
fn exact_utf16_and_signed_zero() {
    assert_eq!(coerce::number_text(&[0xd800]), None);
    assert!(coerce::number_text(&u("-0")).unwrap().is_sign_negative());
    assert_eq!(
        coerce::number_text(&u("0x20000000000001")),
        Some(9007199254740992.0)
    );
    assert_eq!(
        coerce::number_text(&u("0x20000000000003")),
        Some(9007199254740996.0)
    );
}
