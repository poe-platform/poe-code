use tiny_http_mcp_server_rust::testing::{TestTokens, VerificationError};

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn issue(tokens: &mut TestTokens, token: Option<Vec<u16>>, expiry: f64) -> (Vec<u16>, usize) {
    tokens
        .issue(
            token,
            units("issuer"),
            vec![units("resource")],
            vec![units("read")],
            expiry,
        )
        .unwrap()
}

#[test]
fn token_generation_duplicates_and_slots_preserve_original_sequence() {
    let mut tokens = TestTokens::default();
    assert_eq!(issue(&mut tokens, Some(units("test-token-1")), 100.0).1, 0);
    assert_eq!(
        tokens.issue(None, units("issuer"), vec![], vec![], 100.0),
        Err(units("test-token-1"))
    );
    assert_eq!(issue(&mut tokens, None, 100.0), (units("test-token-2"), 1));
    assert_eq!(issue(&mut tokens, Some(vec![0xd800, 0]), 100.0).1, 2);
    assert!(
        tokens
            .issue(Some(vec![0xd800, 0]), vec![], vec![], vec![], 0.0)
            .is_err()
    );
    assert_eq!(tokens.len(), 3);
}

#[test]
fn preflight_admission_precedes_clock_and_preserves_error_order() {
    let mut tokens = TestTokens::default();
    issue(&mut tokens, Some(units("token")), 100.0);
    assert_eq!(
        tokens.lookup(&units("absent"), &units("wrong"), &[]),
        Err(VerificationError::Unknown)
    );
    assert_eq!(
        tokens.lookup(&units("token"), &units("wrong"), &[]),
        Err(VerificationError::Issuer)
    );
    assert_eq!(
        tokens.lookup(&units("token"), &units("wrong"), &[units("issuer")]),
        Err(VerificationError::Audience)
    );
    assert_eq!(
        tokens.lookup(
            &units("token"),
            &units("resource"),
            &[units("other"), units("issuer")]
        ),
        Ok(0)
    );
    assert_eq!(
        tokens.admit(0, &[units("write")], 100.0),
        Err(VerificationError::Expired)
    );
    assert_eq!(
        tokens.admit(0, &[units("write")], 99.0),
        Err(VerificationError::Scope)
    );
    assert_eq!(
        tokens.admit(0, &[units("write"), units("read")], 99.0),
        Ok(())
    );
    assert_eq!(tokens.admit(0, &[], 99.0), Ok(()));
}

#[test]
fn clocks_and_expiry_follow_javascript_numeric_comparisons() {
    let mut tokens = TestTokens::default();
    for expiry in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1.5] {
        let (_, slot) = issue(&mut tokens, None, expiry);
        assert_eq!(tokens.admit(slot, &[], f64::NAN), Ok(()));
        assert_eq!(tokens.admit(slot, &[], 1.5).is_err(), expiry <= 1.5);
    }
}

#[test]
fn thousands_of_tokens_keep_dense_slots_and_both_indexes_consistent() {
    let mut tokens = TestTokens::default();
    for slot in 0..4096 {
        let (token, actual) = issue(&mut tokens, None, 100.0);
        assert_eq!(actual, slot);
        assert_eq!(
            tokens.lookup(&token, &units("resource"), &[units("issuer")]),
            Ok(slot)
        );
    }
    assert_eq!(tokens.len(), 4096);
    assert_eq!(tokens.index_len(), 4096);
}
