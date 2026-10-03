use auth_store_rust::lock::{next_ticket, owner, precedes, protected_paths, validate_timeout};

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

#[test]
fn ticket_selection_uses_the_largest_claim_and_rejects_overflow() {
    assert_eq!(next_ticket(&[]), Ok(1.0));
    assert_eq!(next_ticket(&[0.0, 2.0, 9.0, 4.0]), Ok(10.0));
    assert_eq!(next_ticket(&[-100.0, -0.0]), Ok(1.0));
    assert_eq!(
        next_ticket(&[9_007_199_254_740_990.0]),
        Ok(9_007_199_254_740_991.0)
    );
    for values in [
        &[9_007_199_254_740_991.0][..],
        &[f64::NAN, 1.0],
        &[f64::INFINITY],
        &[0.5],
    ] {
        assert_eq!(
            next_ticket(values),
            Err("Secret-store transaction lock ticket overflow")
        );
    }
}

#[test]
fn predecessors_include_choosing_claims_and_use_utf16_names_to_break_ties() {
    assert!(precedes(None, 1.0, &text("z"), &text("a")));
    assert!(precedes(Some(1.0), 2.0, &text("z"), &text("a")));
    assert!(!precedes(Some(3.0), 2.0, &text("a"), &text("z")));
    assert!(precedes(Some(2.0), 2.0, &text("a"), &text("z")));
    assert!(!precedes(Some(2.0), 2.0, &text("a"), &text("a")));
    assert!(precedes(Some(2.0), 2.0, &[0xd800], &[0xe000]));
    assert!(!precedes(Some(f64::NAN), 2.0, &text("a"), &text("z")));
}
