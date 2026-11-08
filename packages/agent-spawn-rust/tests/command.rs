use agent_spawn_rust::command::{Command, Termination};
use mcp_protocol_rust::json::Value;
#[test]
fn first_termination_wins_and_finished_buffers_are_released() {
    let mut state = Command::new(true, true, 10.0, false);
    assert!(state.group());
    state.stdout(&[65, 0xd800]);
    state.stderr(&[66]);
    assert!(state.terminate(Termination::Timeout));
    assert!(!state.terminate(Termination::Abort));
    let result = state.close(Some(0.0), None).unwrap();
    assert_eq!(result.get("exitCode"), Some(&Value::Number(124.0)));
    assert!(state.close(Some(1.0), None).is_none());
    assert_eq!(state.buffered_units(), 0);
    state.stdout(&[67]);
    assert_eq!(state.buffered_units(), 0);
}
#[test]
fn error_signal_and_preabort_results_preserve_original_policy() {
    let mut state = Command::new(false, false, 0.0, false);
    assert!(!state.group());
    assert_eq!(
        state.close(None, Some(15.0)).unwrap().get("exitCode"),
        Some(&Value::Number(143.0))
    );
    let mut state = Command::new(true, false, 0.0, true);
    assert!(state.preaborted().is_some());
    assert!(!state.terminate(Termination::Timeout));
    let mut state = Command::new(false, false, 0.0, false);
    let result = state.error(&[88], None, Some(-2.0)).unwrap();
    assert_eq!(result.get("exitCode"), Some(&Value::Number(-2.0)));
}
