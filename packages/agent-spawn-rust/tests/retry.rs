use agent_spawn_rust::retry::{Decision, Retry, backoff, prefix_field, retryable};
#[test]
fn retry_admission_and_stop_decisions_are_owned() {
    assert!(Retry::new(0.0, 1.0).is_err());
    assert!(Retry::new(2.0, f64::NAN).is_err());
    let mut state = Retry::new(2.0, 10.0).unwrap();
    assert_eq!(state.begin(false).unwrap(), 1.0);
    assert_eq!(state.evaluate(124.0).unwrap(), Decision::Check);
    assert_eq!(state.finish_check(true).unwrap(), Decision::Wait(10.0));
    assert_eq!(state.begin(false).unwrap(), 2.0);
    assert_eq!(state.evaluate(1.0).unwrap(), Decision::Done);
    assert!(Retry::new(2.0, 1.0).unwrap().begin(true).is_err());
}
#[test]
fn overflow_and_event_prefix_rules_match_javascript() {
    assert_eq!(backoff(100.0, 20.0), 30000.0);
    assert!(backoff(0.0, 2000.0).is_nan());
    assert!(retryable(137.0));
    assert!(!retryable(2.0));
    assert_eq!(prefix_field("tool_complete"), Some("path"));
    assert_eq!(prefix_field("usage"), None);
}
#[test]
fn retry_rejects_out_of_order_transitions() {
    let mut state = Retry::new(3.0, 0.0).unwrap();
    assert!(state.evaluate(1.0).is_err());
    assert!(state.finish_check(true).is_err());
    assert_eq!(state.begin(false).unwrap(), 1.0);
    assert!(state.begin(false).is_err());
    assert!(state.finish_check(true).is_err());
    assert_eq!(state.evaluate(1.0).unwrap(), Decision::Check);
    assert!(state.evaluate(1.0).is_err());
    assert!(state.begin(false).is_err());
    assert_eq!(state.finish_check(true).unwrap(), Decision::Wait(0.0));
    assert!(state.finish_check(true).is_err());
    assert_eq!(state.begin(false).unwrap(), 2.0);
    assert_eq!(state.evaluate(0.0).unwrap(), Decision::Done);
    assert!(state.begin(false).is_err());
    assert!(state.evaluate(1.0).is_err());
}
