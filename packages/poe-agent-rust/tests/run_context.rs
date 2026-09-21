use poe_agent_rust::run_context::Disposal;
#[test]
fn reverse_attempts_keep_only_failed_handles_and_release_success() {
    let mut state = Disposal::default();
    state.add(3);
    state.add(4);
    state.add(5);
    assert_eq!(state.snapshot(), vec![3, 4, 5]);
    state.retain_failed(vec![5, 3]);
    assert_eq!(state.snapshot(), vec![3, 5]);
    state.add(6);
    assert_eq!(state.snapshot(), vec![3, 5, 6]);
    state.clear();
    assert!(state.snapshot().is_empty());
}
