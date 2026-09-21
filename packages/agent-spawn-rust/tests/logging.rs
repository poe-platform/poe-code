use agent_spawn_rust::logging::{filename, normalize_agent, redacted_fields};
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn unicode_scalar_normalization_and_empty_agents_match_host_policy() {
    assert_eq!(normalize_agent(&u("café/👩‍💻_A-9")), u("caf-----_A-9"));
    assert_eq!(normalize_agent(&[]), u("agent"));
    assert_eq!(normalize_agent(&[0xd800]), u("-"));
}
#[test]
fn filenames_keep_utc_parts_and_normalize_session_names() {
    let parts = ["2026", "3", "20", "12", "34", "56", "7"].map(u);
    assert_eq!(
        filename(&parts, &u("my agent"), &u("session/one"), &u("uuid")),
        u("20260320-123456-007-my-agent-session-one.jsonl")
    );
    assert_eq!(
        filename(&parts, &u(""), &u("unknown"), &u("uuid")),
        u("20260320-123456-007-agent-uuid.jsonl")
    );
}
#[test]
fn redaction_selects_only_conversation_and_tool_content() {
    assert_eq!(redacted_fields("tool_start"), &["title", "input"]);
    assert_eq!(redacted_fields("tool_complete"), &["path"]);
    assert_eq!(redacted_fields("reasoning"), &["text"]);
    assert!(redacted_fields("usage").is_empty());
}
