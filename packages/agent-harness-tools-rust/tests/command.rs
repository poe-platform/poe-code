use agent_harness_tools_rust::command::{Lifecycle, Phase, activity_timeout_valid, ulid};
#[test]
fn lifecycle_failure_policy_follows_committed_job_phase() {
    let mut state = Lifecycle::default();
    assert_eq!(state.phase(), Phase::Pending);
    assert_eq!(state.failure_action(), "remove");
    assert!(state.terminal().is_err());
    state.running().unwrap();
    assert_eq!(state.failure_action(), "lost");
    state.terminal().unwrap();
    assert_eq!(state.failure_action(), "none");
    assert!(state.running().is_err());
}
#[test]
fn activity_timeouts_reject_nonfinite_and_nonpositive_numbers() {
    assert!(activity_timeout_valid(None));
    assert!(activity_timeout_valid(Some(0.001)));
    for value in [0.0, -0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(!activity_timeout_valid(Some(value)));
    }
}
#[test]
fn ulid_encodes_timestamp_low_fifty_bits_and_eighty_entropy_bits() {
    assert_eq!(ulid(0, &[0; 10]), "00000000000000000000000000");
    assert_eq!(ulid(u64::MAX, &[255; 10]), "ZZZZZZZZZZZZZZZZZZZZZZZZZZ");
    assert_eq!(
        ulid(1, &[0, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
        "00000000010000000000000001"
    );
}
