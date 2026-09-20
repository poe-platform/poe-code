use mcp_protocol_rust::jsonrpc::Id;
use tiny_stdio_mcp_server_rust::requests::RequestTracker;

fn id(value: &str) -> Id {
    Id::String(value.encode_utf16().collect())
}

#[test]
fn request_ids_are_exclusive_within_a_session_until_the_operation_settles() {
    let mut tracker = RequestTracker::new(4).unwrap();
    let token = tracker.begin(1, Some(id("one")), false).unwrap();
    assert_eq!(tracker.token(1, &id("one")), Some(token));
    assert_eq!(
        tracker
            .begin(1, Some(id("one")), false)
            .unwrap_err()
            .message,
        "Request ID is already active"
    );
    let other = tracker.begin(2, Some(id("one")), false).unwrap();
    assert_ne!(other, token);
    assert!(tracker.finish(token));
    let replacement = tracker.begin(1, Some(id("one")), false).unwrap();
    assert_ne!(replacement, token);
    assert!(!tracker.finish(token));
    assert_eq!(tracker.token(1, &id("one")), Some(replacement));
    assert_eq!(tracker.active_count(), 2);
}

#[test]
fn request_limit_applies_globally_and_anonymous_calls_have_unique_tokens() {
    let mut tracker = RequestTracker::new(2).unwrap();
    let a = tracker.begin(1, None, false).unwrap();
    let b = tracker.begin(2, None, false).unwrap();
    assert_ne!(a, b);
    let error = tracker.begin(3, None, false).unwrap_err();
    assert_eq!(error.code, -32000);
    assert_eq!(error.message, "Too many active requests");
    assert!(tracker.finish(a));
    assert!(tracker.begin(3, None, false).is_ok());
}

#[test]
fn modern_ids_require_strings_or_safe_integers_but_legacy_numbers_remain_compatible() {
    let mut tracker = RequestTracker::new(8).unwrap();
    for value in [
        Id::Null,
        Id::Number(0.5),
        Id::Number(f64::NAN),
        Id::Number(f64::INFINITY),
        Id::Number(9_007_199_254_740_992.0),
    ] {
        let error = tracker.begin(1, Some(value), true).unwrap_err();
        assert_eq!(error.code, -32600);
        assert_eq!(error.message, "Invalid Request ID");
        assert_eq!(tracker.active_count(), 0);
    }
    assert!(tracker.begin(1, Some(id("")), true).is_ok());
    assert!(
        tracker
            .begin(1, Some(Id::Number(9_007_199_254_740_991.0)), true)
            .is_ok()
    );
    assert!(tracker.begin(1, Some(Id::Number(0.5)), false).is_ok());
}

#[test]
fn numeric_keys_match_javascript_map_semantics_and_do_not_alias_strings() {
    let mut tracker = RequestTracker::new(8).unwrap();
    tracker.begin(1, Some(Id::Number(-0.0)), false).unwrap();
    assert!(tracker.begin(1, Some(Id::Number(0.0)), false).is_err());
    assert!(tracker.begin(1, Some(id("0")), false).is_ok());
    tracker.begin(1, Some(Id::Number(f64::NAN)), false).unwrap();
    assert!(
        tracker
            .begin(
                1,
                Some(Id::Number(f64::from_bits(0x7ff8_0000_0000_0001))),
                false
            )
            .is_err()
    );
}

#[test]
fn capacity_must_be_positive() {
    assert!(RequestTracker::new(0).is_err());
}
