use agent_spawn_rust::log_catalog::{parse_filename, sorted_indices};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn timestamps_validate_calendar_dates_and_agent_suffixes() {
    let info = parse_filename(&u("20260321-010203-004-claude-code.jsonl"));
    assert!(info.parsed);
    assert_eq!(info.agent, Some(u("claude-code")));
    assert_eq!(info.timestamp, Some(1774054923004));
    assert_eq!(
        parse_filename(&u("20260229-010203-004-codex.jsonl")).timestamp,
        None
    );
    assert_eq!(
        parse_filename(&u("20240229-235959-999-codex.jsonl")).timestamp,
        Some(1709251199999)
    );
    assert!(!parse_filename(&u("manual.jsonl")).parsed);
}
#[test]
fn sorting_matches_utf16_and_is_stable_for_equal_names() {
    assert_eq!(
        sorted_indices(&[u("a"), u("🌍"), u("界"), u("a")]),
        vec![1, 2, 0, 3]
    );
}
