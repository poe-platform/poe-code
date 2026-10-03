use auth_store_rust::lock::{owner, protected_paths, validate_timeout};

fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}

#[test]
fn timeout_accepts_the_javascript_timer_domain_and_unlimited_waits() {
    for value in [0.0, -0.0, 0.5, 2_147_483_647.0, f64::INFINITY] {
        assert!(validate_timeout(value).is_ok());
    }
    for value in [-1.0, f64::NEG_INFINITY, f64::NAN, 2_147_483_648.0] {
        assert_eq!(
            validate_timeout(value),
            Err("Invalid secret-store transaction lock timeout")
        );
    }
}

#[test]
fn claim_owners_require_canonical_positive_safe_integer_pids() {
    let own = text("7-own.claim");
    assert_eq!(owner(&own, &own), Ok(None));
    assert_eq!(owner(&text("invalid.tmp"), &own), Ok(None));
    for (name, pid) in [
        ("1-peer.claim", 1.0),
        ("42-.claim", 42.0),
        ("9007199254740991-peer.claim", 9_007_199_254_740_991.0),
        ("123-雪.claim", 123.0),
    ] {
        assert_eq!(owner(&text(name), &own), Ok(Some(pid)));
    }
    for name in [
        ".claim",
        "1.claim",
        "0-peer.claim",
        "01-peer.claim",
        "-1-peer.claim",
        "+1-peer.claim",
        "1.0-peer.claim",
        "1e2-peer.claim",
        " 1-peer.claim",
        "0x10-peer.claim",
        "9007199254740992-peer.claim",
        "١-peer.claim",
        "9999999999999999999999999999999999-peer.claim",
    ] {
        assert_eq!(
            owner(&text(name), &own),
            Err("Malformed secret-store transaction lock owner"),
            "{name}"
        );
    }
}

#[test]
fn lock_paths_preserve_os_root_aliases_and_protect_every_other_ancestor() {
    assert_eq!(protected_paths(&text("/"), 1, 47), Vec::<Vec<u16>>::new());
    assert_eq!(protected_paths(&text("/locks"), 1, 47), [text("/locks")]);
    assert_eq!(
        protected_paths(&text("/var/tmp/locks"), 1, 47),
        [text("/var/tmp"), text("/var/tmp/locks")]
    );
    assert_eq!(
        protected_paths(&text("C:\\"), 3, 92),
        Vec::<Vec<u16>>::new()
    );
    assert_eq!(
        protected_paths(&text("C:\\root\\locks"), 3, 92),
        [text("C:\\root\\locks")]
    );
}
