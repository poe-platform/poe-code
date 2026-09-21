use agent_spawn_rust::adapters::Adapter;
use mcp_protocol_rust::json::Value;
#[test]
fn independent_adapters_preserve_surrogates_and_isolate_sessions() {
    let mut adapter = Adapter::new("claude").unwrap();
    let first=adapter.line(&r#"{"type":"assistant","session_id":"s","message":{"content":[{"type":"tool_use","id":"1","name":"Read","input":{"file_path":"x\ud800"}}]}}"#.encode_utf16().collect::<Vec<_>>());
    assert_eq!(first.len(), 2);
    let value = first[1].get("value").unwrap();
    assert_eq!(value.get("title"), Some(&Value::String(vec![120, 0xd800])));
    let mut other = Adapter::new("claude").unwrap();
    assert_eq!(other.tracked_tools(), 0);
    assert_eq!(adapter.tracked_tools(), 1);
    let events=other.line(&r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"1","content":"done"}]}}"#.encode_utf16().collect::<Vec<_>>());
    assert_eq!(events.len(), 2);
}
#[test]
fn codex_completion_without_start_emits_both_and_releases_tracking() {
    let mut adapter = Adapter::new("codex").unwrap();
    let events=adapter.line(&r#"{"type":"item.completed","item":{"type":"command_execution","id":"c","command":"pwd","exit_code":1}}"#.encode_utf16().collect::<Vec<_>>());
    assert_eq!(events.len(), 2);
    assert_eq!(adapter.tracked_tools(), 0);
    assert!(Adapter::new("constructor").is_err());
}
