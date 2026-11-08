use agent_spawn_rust::stream::{Dispatch, LineBuffer, validate_callback};
#[test]
fn split_lines_preserve_carriage_returns_surrogates_and_release_consumed_capacity() {
    let mut lines = LineBuffer::default();
    assert!(lines.push(&[65, 0xd800]).is_empty());
    assert_eq!(
        lines.push(&[13, 10, 10, 66]),
        vec![vec![65, 0xd800, 13], vec![]]
    );
    assert_eq!(lines.end(), Some(vec![66]));
    assert_eq!(lines.end(), None);
    assert_eq!(lines.retained_capacity(), 0);
}
#[test]
fn middleware_dispatch_rejects_repeat_and_invalid_callbacks() {
    let mut state = Dispatch::default();
    assert!(state.enter(0, 2).unwrap());
    assert!(state.enter(1, 2).unwrap());
    assert!(!state.enter(2, 2).unwrap());
    assert!(state.enter(1, 2).is_err());
    assert!(validate_callback(0, false).unwrap_err().contains("index 0"));
}
#[test]
fn completed_large_line_does_not_pin_capacity_behind_a_small_tail() {
    let mut lines = LineBuffer::default();
    let mut chunk = vec![65; 1024 * 1024];
    chunk.extend([10, 66]);
    assert_eq!(lines.push(&chunk)[0].len(), 1024 * 1024);
    assert!(lines.retained_capacity() < 4096);
    assert_eq!(lines.end(), Some(vec![66]));
    assert!(lines.push(&[65; 100]).is_empty());
    assert_eq!(lines.retained_capacity(), 0);
}

#[test]
fn streaming_lines_normalize_crlf_without_changing_the_generic_reader() {
    let mut lines = agent_spawn_rust::stream::LineBuffer::new(true);
    assert_eq!(
        lines.push(&[97, 13, 10, 13, 10, 98, 13]),
        vec![vec![97], vec![]]
    );
    assert_eq!(lines.end(), Some(vec![98]));
}
#[test]
fn streaming_usage_preserves_finite_numbers_and_optional_presence() {
    let mut usage = agent_spawn_rust::stream::Usage::default();
    usage.observe([Some(3.0), Some(2.0), Some(0.0), None]);
    usage.observe([Some(-1.0), Some(f64::NAN), Some(f64::INFINITY), Some(0.25)]);
    let value = usage.value();
    assert_eq!(
        value.get("inputTokens"),
        Some(&mcp_protocol_rust::json::Value::Number(2.0))
    );
    assert_eq!(
        value.get("outputTokens"),
        Some(&mcp_protocol_rust::json::Value::Number(2.0))
    );
    assert_eq!(
        value.get("cachedTokens"),
        Some(&mcp_protocol_rust::json::Value::Number(0.0))
    );
    assert_eq!(
        value.get("costUsd"),
        Some(&mcp_protocol_rust::json::Value::Number(0.25))
    );
}
