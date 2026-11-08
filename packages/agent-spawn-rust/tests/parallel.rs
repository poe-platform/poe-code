use agent_spawn_rust::parallel::{Rejection, Scheduler};
#[test]
fn bounded_admission_and_ordered_failure() {
    assert!(Scheduler::new(2, 0.0, true, true).is_err());
    assert!(Scheduler::new(2, f64::INFINITY, true, true).is_err());
    let mut state = Scheduler::new(4, 2.0, true, false).unwrap();
    assert_eq!(state.workers(), 2);
    assert_eq!(state.take(), Some(0));
    assert_eq!(state.take(), Some(1));
    assert_eq!(state.take(), None);
    assert!(!state.complete(1, false).unwrap());
    assert_eq!(state.take(), Some(2));
    assert!(!state.complete(2, false).unwrap());
    assert!(!state.complete(0, true).unwrap());
    assert_eq!(state.first_failed(), Some(1));
    assert!(state.complete(0, true).is_err());
}
#[test]
fn primary_failure_stops_new_calls_and_preserves_peer_cleanup() {
    let mut state = Scheduler::new(4, 2.0, true, true).unwrap();
    assert_eq!(state.take(), Some(0));
    assert_eq!(state.take(), Some(1));
    assert!(state.complete(1, false).unwrap());
    assert_eq!(state.take(), None);
    assert_eq!(state.reject(0, true).unwrap(), Rejection::Ignore);
    assert!(!state.stop());
    let mut state = Scheduler::new(3, 1.0, false, false).unwrap();
    assert_eq!(state.take(), Some(0));
    assert_eq!(state.reject(0, false).unwrap(), Rejection::Collect);
    assert_eq!(state.take(), Some(1));
    assert_eq!(state.reject(1, true).unwrap(), Rejection::Primary);
    assert_eq!(state.take(), None);
}
